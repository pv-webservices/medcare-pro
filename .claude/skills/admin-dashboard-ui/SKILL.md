---
name: admin-dashboard-ui
description: Guidance for building MEDCARE PRO's clinic admin dashboard UI — the design system, its tokens and primitives, and the usability rules for non-technical front-desk staff. Use when building or styling any page under src/app/(dashboard), or any component under src/components/.
---

# Admin Dashboard UI

MEDCARE PRO is an internal operations tool for front-desk staff at Indian
clinics, not a marketing site. Optimize for speed of use during a busy front
desk.

## Polish vs. discipline — how they reconcile

"No visual flair" does not mean "unstyled." It means **every visual decision has
to pay for itself in speed of use**. A design system that is dense, legible,
consistent and quick to scan is not decoration — it is the feature. So:

- Polish that **serves the eye's path** — type hierarchy, tabular alignment,
  surface separation, consistent row rhythm, generous tap targets — is required.
- Polish that **only serves the eye** — gradients, hero art, illustrated empty
  states, animated flourishes, decorative accent colour on elements with no
  meaning — is cut.

The test for any styling choice: *name the operational job it does.* If you
cannot, delete it.

## The design system

Tokens live in `src/app/globals.css`. Primitives live in
`src/components/ui/`. **Do not hand-roll a button, input, table, panel or pill
anywhere else** — extend the primitive instead, so a fix lands once.

### Colour

Five neutrals carry the whole shell. They are cool and faintly green-cast, so
they sit under any clinic's brand colour without fighting it:

| Token | Job |
|---|---|
| `--paper` | Page canvas |
| `--surface` | Cards, panels, table body — raised above the canvas |
| `--surface-sunk` | Table headers, selected rows, inset wells |
| `--ink` | Primary text, primary-action fills |
| `--muted` | Labels, secondary text, column headers |
| `--line` | Rules and borders |

Three status hues are **functional signals**, dictated by meaning, never taste:
`--ok` (delivered, active, verified), `--warn` (queued, pending, expiring),
`--alert` (failed send, validation error, destructive action). Never use them to
make something look nice.

### The live clinic accent (the one signature element)

`--accent` is **not** a fixed brand colour. It is the selected clinic's own
`Clinic.themeColor` (FR-8.4), injected as an inline custom property by
`src/app/(dashboard)/layout.tsx` and swapped whenever `ClinicSwitcher` changes
the selection.

This is the one place colour carries identity rather than status, and it earns
that exception: an account owner managing four clinics from one login has a real,
costly failure mode — registering a patient into the wrong clinic. The accent is
the standing answer to "which clinic am I writing into right now?"

The accent appears in exactly three places. Do not add a fourth without a reason
of the same weight:

1. **The clinic rail** — a 4px vertical bar. It runs down the sidebar's brand
   block at app scale, and down the left edge of each row on the clinics list at
   list scale. Same object, two scales, teaching one relationship.
2. **Commit buttons** — the button that writes a record is filled with the
   accent, so the clinic you are writing into is visible at the instant you
   commit. `commit` means a write into a clinic's records and nothing else: a
   button that only navigates or narrows a list — "Apply Filters", "Export CSV",
   pagination — is `primary` or `secondary`. Spending the clinic's colour on
   those blunts the one signal that matters.
3. **Selected-row emphasis** on lists, paired with a "Viewing" pill.

Never put the raw accent behind text you did not compute a foreground for.
`src/lib/theme.ts` returns `--accent` (raw, for rails and swatches) plus
`--accent-solid` / `--accent-ink` — a pair guaranteed to clear 4.5:1. Use the
pair for anything with a label on it. Focus rings use `--ink`, never the accent:
a safety affordance cannot depend on a colour the user chose.

When no clinic is selected ("All clinics"), the accent falls back to the house
teal and the rail renders neutral — the absence is itself the signal that you
are in account-wide mode.

### Type

Two faces, loaded via `next/font` in `src/app/layout.tsx`:

- **Anek Latin** (`font-display`) — headings only. An Ek Type (Mumbai) design
  whose siblings cover Devanagari and the South Indian scripts, so this UI can
  grow Hindi or Marathi labels later without a type change. Used at page titles
  and panel headings, nowhere else.
- **IBM Plex Sans** (`font-sans`) — everything else. Drawn for dense enterprise
  interfaces, with true tabular figures and an unambiguous `1`/`l`/`I`, which is
  what mobile numbers and amounts need.

**One hard rule: Anek never touches a digit.** Every number in this app —
rupee amounts, patient and doctor counts, ages, Patient IDs, dates — is IBM Plex
Sans with `tabular-nums`, so columns align down the page.

Scale: `text-micro` (11px caps, eyebrows and pill text) · `text-label` (13px,
field labels and column headers) · `text-body` (15px, the default) ·
`text-section` (17px, panel headings) · `text-title` (22px, page titles) ·
`text-metric` (28px, the numbers staff check first).

Inputs are 16px (`text-input`) regardless — anything smaller makes iOS Safari
zoom on focus, which is intolerable on a shared front-desk tablet.

### Patient IDs and amounts

- Patient IDs (`PT-2026-0041`) use the `serial` utility — tabular figures with
  open tracking, so a staff member can read one aloud over the phone without
  losing their place.
- Rupee amounts always go through `formatRupees()` in `src/lib/money.ts`, which
  uses `en-IN` grouping. `₹1,50,000.00`, never `₹150,000.00`. Chart ticks use
  `formatRupeesCompact()` — lakh and crore, never `K`/`M`.

### Icons

`lucide-react`, imported directly at the call site — there is no icon barrel to
keep in sync. Two sizes only: `h-4 w-4` beside text (buttons, table
affordances, meta lines) and `h-5 w-5` standing alone. Always
`strokeWidth={1.75}`, which matches the weight of the type; lucide's default of
2 reads heavy against IBM Plex at these sizes.

An icon either repeats a word or replaces one. If it repeats — a chevron next
to "Next", a download next to "Export CSV" — it is `aria-hidden` and the text
carries the meaning. If it replaces one, the control needs an `sr-only` label
saying what it does. Never a bare icon button with neither.

No icon is decorative. An icon in a heading, an empty state or a status pill is
decoration; delete it.

### Spacing, radius, shadow

Spacing is Tailwind's 4px scale. The density rules that matter: table rows are
`py-3`, form fields stack at `gap-4`, panels pad at `p-5`, the page gutter is
`p-4` on tablet and `p-6` above.

Radius: `rounded-sm` (4px) swatches · `rounded-md` (6px) controls ·
`rounded-lg` (10px) cards and panels · `rounded-full` pills only.

Shadow is nearly absent by design — a data tool should not float.
`shadow-card` for resting surfaces, `shadow-pop` for things that genuinely
overlay (toasts, menus). Nothing else gets a shadow.

## Ground rules

- **Data-first, not decoration-first.** Every screen's job is to let staff find
  or record something fast. No hero sections, no marketing copy, no illustration
  filler.
- **Use the PRD's vocabulary exactly.** The words are **Registration**, **Visit**,
  **Visit Type** (`New patient` / `Follow-up`), **Patient ID**, **Department**,
  **Availability**, **Leave**, **Clinic**, **Account**, **Notification**,
  **Message**, **Template**, **Role**, **Branding**. Never soften these into
  "Record", "Entry", "Booking" or "Appointment" — MEDCARE PRO does not schedule
  appointments, it logs registrations of visits that already happened. Staff
  should never have to translate the interface's words into the clinic's words.
- **Empty and error states are functional, not cute.** "No registrations logged
  at this clinic today" beats an illustration with no explanation. Every error
  state says what happened and what to do next — never a bare "Something went
  wrong." Use the `EmptyState` primitive so the pattern stays identical.
- **Active voice on every action.** A button says what happens: "Add Clinic,"
  "Save Registration," "Send Message" — not "Submit" or "Confirm." The action
  keeps its name through the whole flow, so "Add Clinic" produces the toast
  "Clinic added."
- **Colour is functional, not decorative.** Reserve `--alert` and `--warn` for
  things needing action — a failed WhatsApp send, an unread notification, a
  validation error. The accent is reserved for clinic identity (above). Nothing
  else gets colour.
- **Numbers stay legible.** Revenue totals and patient counts should be the
  largest, highest-contrast text on the page — they are the first thing staff
  check each morning. Right-align every numeric column, always `tabular-nums`.
- **Design for a tablet at a front desk**, not just a widescreen monitor. Tap
  targets are 44px minimum; test at ~768px width, not just desktop and mobile.
- **Consistency over novelty.** One list pattern serves clinics, doctors,
  registrations, notifications and messages: a `Table` on tablet and up, the
  same fields as stacked cards below. Staff should recognize a pattern once and
  reuse that knowledge everywhere.
- **Every screen opens with `PageHeader`.** Title, one meta line, the page's
  actions. The meta line is what tells staff whether the list in front of them
  is everything or a slice — how many rows, at which clinic, filtered or not —
  so it is a sentence in that order, with the numbers in `Count`. A leaf screen
  passes `back`; a top-level list does not.

## Forms

- Inline validation, not just on-submit — a bad mobile number should be flagged
  as the staff member types, not after they hit save. Surface the message only
  once the field has been touched, so a blank form is not a wall of red.
- Client validation mirrors the server's zod schema; the server stays
  authoritative. Never let the two drift.
- Pre-fill what is already known. Looking up an existing patient (FR-3.1a) fills
  their details and reuses their Patient ID — it never asks for the mobile number
  a second time, and never issues a second ID to the same person.
- Confirm the write. Every successful save raises a toast naming what happened.

## Status vocabulary

Use `StatusPill` with these tones, consistently, everywhere:

| Meaning | Tone | Example |
|---|---|---|
| Delivered, active, verified | `ok` | WhatsApp `delivered`/`read`, verified account |
| Queued, pending, in progress | `warn` | WhatsApp `queued`, unread notification |
| Failed, blocked, destructive | `alert` | WhatsApp `failed`, rejected template |
| Neutral fact, no action | `neutral` | `Follow-up` visit type, role name |
| Current selection | `accent` | The "Viewing" pill on the selected clinic |

## When in doubt

Ask: "Would a front-desk worker mid-rush find this obvious in under 2 seconds?"
If not, simplify — don't add an explanation, remove the ambiguity.
