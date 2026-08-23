import { Prisma } from "@prisma/client";
import { OCCUPYING_STATUSES, orderLockKeys } from "@/lib/appointmentRules";

/**
 * The DoctorScheduleLock protocol, in one place — AP-4.
 *
 * AP-3 wrote this inline because booking was the only path that needed it. AP-4
 * adds four more — reschedule, cancel, no-show, check-in — and AP-5 adds
 * conversion, so the protocol is extracted here rather than copied five times.
 * The rule it implements is recorded verbatim on the `DoctorScheduleLock` model
 * in prisma/schema.prisma and in prisma/migrations/APPOINTMENT_NOTES.md, and
 * both were arrived at by racing real transactions rather than by reasoning.
 *
 * Nothing in this file decides WHO may do anything. It is the serialisation
 * layer only; authorisation happens in the callers, before their transactions
 * open.
 */

/**
 * The one message a losing write ever sees — a booking or a move.
 *
 * It names no competing appointment, no patient, no colleague and no
 * constraint. A front desk that can probe "is 09:30 taken, and by whom?"
 * through error text has a patient-privacy leak dressed as a validation
 * message.
 *
 * Defined here rather than in either caller so booking and rescheduling cannot
 * drift into telling the user two different things about the same situation.
 */
export const SLOT_TAKEN_MESSAGE =
  "This time slot was just booked. Please select another slot.";

/** Prisma's code for a unique-constraint violation. */
export function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export interface DoctorDayLockKey {
  doctorId: string;
  /** "YYYY-MM-DD" — from appointmentLockDate(), never assembled by hand. */
  date: string;
}

/**
 * The lock row's primary key, derived rather than random.
 *
 * It MUST match the id AP-3's booking path writes, character for character. Two
 * different ids for the same (doctorId, date) would attempt two rows, the
 * unique index would reject the second, and a booking and a cancellation could
 * end up serialising on nothing. The unique index is on (doctor_id, date), so
 * the id only has to be deterministic — this is the cheapest way to make it so.
 */
export function doctorDayLockId(key: DoctorDayLockKey): string {
  return `lock-${key.doctorId}-${key.date}`;
}

/**
 * Steps 1 and 2 of the protocol, for every doctor-day a write touches.
 *
 * ON DUPLICATE KEY UPDATE, NEVER `INSERT IGNORE`. This is the single most
 * important line here, and AP-1 proved it by racing real transactions:
 * INSERT IGNORE takes a SHARED lock on the conflicting index record, so two
 * writers for the same doctor-day both take an S lock and both then try to
 * upgrade to the X lock the SELECT ... FOR UPDATE needs — a lock-upgrade
 * deadlock (MySQL 1213) in which neither succeeds and the loser is not even a
 * clean conflict a caller could report. ON DUPLICATE KEY UPDATE takes the X
 * lock directly, so the second writer blocks and waits. Setting updated_at to
 * itself is a deliberate no-op: the row's contents are irrelevant, only the
 * lock on it matters.
 *
 * ASCENDING (doctorId, date), via orderLockKeys. Booking touches one doctor-day
 * and cannot deadlock. A RESCHEDULE touches two — the slot being vacated and
 * the one being taken, possibly under different doctors — and would deadlock
 * against its own mirror image without a deterministic order. The ordering is
 * applied here rather than trusted to each caller, so a future path cannot
 * forget it. Duplicates collapse, so a same-doctor same-day move takes one lock.
 */
export async function takeDoctorDayLocks(
  tx: Prisma.TransactionClient,
  keys: readonly DoctorDayLockKey[],
): Promise<void> {
  for (const key of orderLockKeys([...keys])) {
    await tx.$executeRaw(
      Prisma.sql`
        INSERT INTO doctor_schedule_locks
          (id, doctor_id, date, created_at, updated_at)
        VALUES (${doctorDayLockId(key)}, ${key.doctorId}, ${key.date}, NOW(3), NOW(3))
        ON DUPLICATE KEY UPDATE updated_at = updated_at
      `,
    );

    // The serialisation point, stated explicitly. The statement above already
    // holds the X lock, so this is belt-and-braces — but it keeps the lock held
    // if that statement is ever rewritten, and it is where a competing
    // transaction visibly blocks.
    await tx.$queryRaw(
      Prisma.sql`
        SELECT id FROM doctor_schedule_locks
        WHERE doctor_id = ${key.doctorId} AND date = ${key.date}
        FOR UPDATE
      `,
    );
  }
}

/**
 * Step 3: is any of this doctor's time already taken across [start, end)?
 *
 * Half-open, so an appointment ending exactly when this one starts is not a
 * conflict. Filtered to the statuses that actually occupy the doctor —
 * CONVERTED among them, because a completed visit consumed the time just as
 * surely as a booked one.
 *
 * BY DOCTOR, not by clinic: a doctor's time is occupied wherever the
 * appointment was filed, and narrowing by clinic could hide a real conflict.
 *
 * FOR UPDATE, always. A plain read cannot see a competitor that commits between
 * the lock being taken and the write, and under MySQL's default REPEATABLE READ
 * it would be pinned to a snapshot from the transaction's first read. Callers
 * must run this inside a READ COMMITTED transaction — see
 * `appointmentTransaction`.
 *
 * `excludeAppointmentId` exists for paths that are moving a row rather than
 * adding one. It is an id the caller has already resolved and already holds
 * authorisation over, never one taken off a request.
 */
export async function findOccupyingClash(
  tx: Prisma.TransactionClient,
  input: {
    doctorId: string;
    slotStart: Date;
    slotEnd: Date;
    excludeAppointmentId?: string;
  },
): Promise<boolean> {
  const exclusion = input.excludeAppointmentId
    ? Prisma.sql`AND id <> ${input.excludeAppointmentId}`
    : Prisma.empty;

  const clash = await tx.$queryRaw<{ id: string }[]>(
    Prisma.sql`
      SELECT id FROM appointments
      WHERE doctor_id = ${input.doctorId}
        AND status IN (${Prisma.join([...OCCUPYING_STATUSES])})
        AND slot_start < ${input.slotEnd}
        AND slot_end > ${input.slotStart}
        ${exclusion}
      FOR UPDATE
    `,
  );

  return clash.length > 0;
}

/**
 * Takes a row lock on one appointment and returns the state it is ACTUALLY in.
 *
 * Every AP-4 path validates the current status before its transaction opens, so
 * a caller can be refused cheaply and with a good message. That check is
 * advisory: between it and the write, another request may have cancelled the
 * same appointment, checked it in, or moved it. This re-read is the
 * authoritative one, and it is a locking read, so a competing transaction blocks
 * here rather than both proceeding from the same stale status.
 *
 * Two receptionists cancelling the same appointment at once is the ordinary
 * case, and without this the second would overwrite the first's `cancelledAt`
 * and `cancelledById` — quietly rewriting who did it.
 *
 * Returns null when the row is gone, which cannot normally happen (nothing in
 * this system deletes an appointment) but is not worth crashing over.
 */
export async function lockAppointmentRow(
  tx: Prisma.TransactionClient,
  appointmentId: string,
): Promise<{ id: string; status: string } | null> {
  const rows = await tx.$queryRaw<{ id: string; status: string }[]>(
    Prisma.sql`
      SELECT id, status FROM appointments
      WHERE id = ${appointmentId}
      FOR UPDATE
    `,
  );

  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// The transaction wrapper
// ---------------------------------------------------------------------------

/**
 * How many times a deadlocked transaction is retried before the caller sees it.
 *
 * Small on purpose. A deadlock here means two writers genuinely collided, and
 * the second attempt runs after the first has committed, so it either succeeds
 * or fails as a clean conflict. Retrying many times would turn a design fault
 * into a latency problem instead of surfacing it.
 */
const MAX_DEADLOCK_ATTEMPTS = 3;

/** 25ms, then 50ms. Enough for the winner to commit and release its locks. */
const RETRY_BACKOFF_MS = 25;

/**
 * MySQL 1213: "Deadlock found when trying to get lock; try restarting
 * transaction".
 *
 * Checked several ways because Prisma surfaces it differently depending on how
 * the statement was issued: a raw query arrives as P2010 carrying the driver's
 * own number, while the query engine reports its own P2034 for a write
 * conflict. Matching the message as well costs nothing and covers a driver that
 * reports neither.
 */
export function isDeadlockError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  if (error.code === "P2034") {
    return true;
  }

  const meta = (error.meta ?? {}) as { code?: unknown; message?: unknown };

  if (String(meta.code) === "1213") {
    return true;
  }

  const text = `${String(meta.message ?? "")} ${error.message}`.toLowerCase();

  return text.includes("deadlock");
}

/**
 * Runs one appointment write at the isolation level the protocol requires,
 * retrying a genuine deadlock a bounded number of times.
 *
 * READ COMMITTED, and the reason is specific. Under MySQL's default REPEATABLE
 * READ the locking overlap query takes GAP LOCKS over the index range it scans
 * even when it matches nothing — the common case for a free slot — so two
 * writes for DIFFERENT doctors at the same time of day deadlock each other on
 * the same gap. In production that looks like random booking failures under
 * load. READ COMMITTED takes no gap locks, and gives every statement the latest
 * committed data rather than a snapshot pinned at the transaction's first read,
 * which is also what makes the in-transaction re-reads meaningful.
 *
 * THE RETRY IS INSURANCE, NOT THE DESIGN. Correct lock ordering is what makes a
 * deadlock impossible between two reschedules; APPOINTMENT_NOTES.md asks for a
 * bounded retry anyway, on the grounds that the ordering guarantee holds only if
 * every path obeys it and a future path might not. A retry that fires regularly
 * is a bug report, not a solution.
 *
 * Only a deadlock is retried. A ConflictError — the slot really is taken — is
 * rethrown at once, because retrying would take longer to say the same thing.
 */
export async function appointmentTransaction<T>(
  prismaClient: {
    $transaction: <R>(
      fn: (tx: Prisma.TransactionClient) => Promise<R>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) => Promise<R>;
  },
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_DEADLOCK_ATTEMPTS; attempt += 1) {
    try {
      return await prismaClient.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      });
    } catch (error: unknown) {
      if (!isDeadlockError(error)) {
        throw error;
      }

      lastError = error;

      if (attempt < MAX_DEADLOCK_ATTEMPTS) {
        await sleep(RETRY_BACKOFF_MS * attempt);
      }
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
