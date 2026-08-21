# Stage 1 migration notes

Schema foundation for Platform Owner, entitlements, invitations, sessions and
audit. **Nothing in Stage 1 is wired into a runtime code path.** No existing
request is authorised differently after this migration than before it.

## Run order

Local only. Do not run any of this against production.

```bash
npx prisma migrate deploy      # applies stage1_expand
npm run stage1:backfill        # localhost-guarded, idempotent
npm run stage1:verify          # must pass; section 9 reports "not yet applied"
npx prisma migrate deploy      # applies stage1_constrain
npm run stage1:verify          # must pass with zero skips
```

Then re-run the pre-existing suites, which must be unaffected:

```bash
npm run verify:roles
npm run verify:registrations
npm run verify:reports
npm run verify:notifications
npm run verify:whatsapp
```

## Why two migrations

`20260822090000_stage1_expand` is purely additive: every new column on an
existing table is nullable or defaulted, and every new table starts empty so its
unique indexes are safe. Nothing it does can fail on existing data.

Five columns end up `NOT NULL` in the schema but are added nullable, because
MySQL cannot add a `NOT NULL` column without a default to a table that already
has rows, and because `NULL` is the signal that a row has not been backfilled:

| column | backfilled from |
|---|---|
| `tenants.updated_at` | the row's own `created_at` |
| `users.updated_at` | the row's own `created_at` |
| `roles.created_at` | the owning **tenant**'s `created_at` (approximation) |
| `roles.updated_at` | the owning **tenant**'s `created_at` (approximation) |
| `user_roles.created_at` | the owning **user**'s `created_at` (approximation) |

`roles.created_at` and `user_roles.created_at` are added **without** a default
on purpose: `ADD COLUMN ... DEFAULT CURRENT_TIMESTAMP` would stamp every
existing row with the migration time, which is not when those rows were created.
The default is introduced by the constrain migration, after the honest values
are in place.

`20260822090100_stage1_constrain` tightens those five columns and adds the two
unique indexes that were deferred (`tenants.slug`, `roles(tenant_id, key)`).
Each statement fails loudly if a row is still un-backfilled — that is the point.

`tenants.slug` is **unique but still nullable**. Requiring it would change the
type of `prisma.tenant.create()` and force an edit to `api/auth/signup`, which
Stage 1 must not touch. Stage 3 rewrites signup to generate a slug and tightens
the column then.

## Data-preservation guarantees

- No `DROP`, no `DELETE`, no destructive `UPDATE` in either migration.
- **`user_roles` row count is unchanged.** Only the two new nullable columns are
  written. The backfill asserts the count in-process against a pre-run snapshot
  and `stage1:verify` re-checks the invariants absolutely.
- `assigned_by_id` stays `NULL` on every pre-existing row. The original actor
  was never recorded, and it is not invented.
- **Role permissions are only ever written for a demonstrably untouched seeded
  Admin role** — one whose permission set is exactly the frozen
  `HISTORICAL_ALL_PERMISSIONS` (20 keys). One key added or removed by the tenant
  and the role is skipped. Custom roles are never touched.
- `seedDefaultRoles()` behaviour is unchanged and is **not** run over existing
  tenants; the backfill uses the create-only `addMissingDefaultRoles()`.
- Verified tenants are grandfathered to `ACTIVE` with `approved_at = created_at`
  and `approved_by_id = NULL`. Nobody who can log in today loses access.
  Unverified tenants stay `PENDING`, which is what they effectively already
  were — `lib/auth.ts` blocks their logins either way.
- Existing users inherit their organisation's `email_verified_at`. This is a
  documented grandfathering decision and applies **only** to users that already
  existed; members invited from Stage 5 onward verify their own address.

## Rollback

The expand migration is reversible by dropping what it added; nothing it does
destroys data, so a restore is only needed if the constrain migration has run.
Back up before starting:

```bash
mysqldump -h 127.0.0.1 -P 3307 -u root -p medcare_pro > backup-pre-stage1.sql
```

To undo without a restore, drop the ten new tables and the added columns in
reverse dependency order. The pre-Stage-1 application code reads none of them,
so an un-migrated checkout runs against a migrated database unchanged.

## Enum migration cost

Six native enums are introduced (`PlatformRole`, `TenantStatus`,
`UserAccountStatus`, `MembershipStatus`, `InvitationStatus`, `FeatureTier`).
This departs from the schema's `String` convention, which exists for **open**
sets a clinic may extend; these are **closed** sets guarding access, where an
unrecognised value must never read as "active" or "authorised".

Adding a value later is an `ALTER TABLE ... MODIFY COLUMN ENUM(...)` on each
table using it — a column-definition rewrite under a metadata lock, cheap at
this scale. Removing or renaming a value is breaking and needs a data backfill
first.

## Known ceilings, recorded now

- **`rate_limit_buckets`** serialises writes on the hottest keys and will not
  hold up across multiple app instances. Stage 4 must keep its interface
  swappable so it can move to Redis or an in-memory tier without touching call
  sites. No Redis in Stage 1 (PRD §11).
- **`login_codes.code_hash`** is `VARCHAR(255)` so Stage 4 can pick between
  bcrypt and HMAC-SHA256. A six-digit code carries ~20 bits of entropy, so a
  plain unsalted SHA-256 is reversible from a database dump in milliseconds.
  Stage 4 must use bcrypt or an HMAC keyed with a pepper held outside the
  database.
- **One user, one tenant.** `users.tenant_id` is non-null, so `UserRole` plus
  that column is the whole membership model. Supporting a person who works for
  several organisations would need a separate `Membership` table. Deliberately
  not designed for here.

## Carried forward: required changes before later stages

These were decided during Stage 1 local validation. Neither is implemented
here — Stage 1 adds no runtime authorization — but both are binding on the
stage named.

### Before Stage 8 — role-level feature default depends on tier

Stage 1 shipped a single rule: an absent `RoleFeatureAccess` row inherits the
tenant entitlement. That is right for the features that already exist, and
wrong for anything sold later. A tenant buying a premium feature must not have
it appear for every role at once; the Tenant Admin decides who gets it.

The corrected rule keys off `Feature.tier`, which already exists and is
indexed, so **no schema change and no seed rows are required**:

- `CORE`     — absence means allow. Existing roles keep working exactly as they
  do today, with no backfill and no (role x feature) row explosion.
- `PREMIUM`, `BETA`, `INTERNAL` — absence means deny. A newly entitled feature
  stays invisible until the Tenant Admin enables it for a named role.

The change is confined to `src/lib/featureResolution.ts`: add `tier` to
`FeatureResolutionInput`, and replace

    if (input.roleAccess === false) return { allowed: false, reason: "role" };

with a branch that also denies when `roleAccess === null` and the tier is not
`CORE`. Every caller already has the feature row in hand.

`role_feature_access` is empty after the Stage 1 backfill, so making this
change later costs nothing — there are no rows to reinterpret. It must land
before Stage 8 turns entitlement checks on, and before any non-CORE feature is
sold.

### Before Stage 4 — login code storage

`login_codes.code_hash` must never hold a plain unsalted SHA-256 digest. A
six-digit code is ~20 bits; a dump is brute-forced instantly. Stage 4 acceptance
criteria:

- Hash with **HMAC-SHA-256 under a server-side pepper** held outside the
  database (env/secret manager), or with **bcrypt/argon2** at a sane work
  factor.
- For HMAC, bind the input to the challenge: include the user id and the
  challenge/code id, not the six digits alone, so a digest cannot be replayed
  against another challenge.
- Compare in constant time (`crypto.timingSafeEqual`), never with `===`.
- Enforce expiry, cap attempts, and increment the attempt counter atomically.
- Consume the code atomically, so two concurrent requests cannot both redeem it.
- Slow hashing is not a substitute for rate limiting — keep the
  `RateLimitBucket` check regardless.
- Never log the code, the HMAC input, or the digest.
