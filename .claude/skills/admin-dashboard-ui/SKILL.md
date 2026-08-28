---
name: admin-dashboard-ui
description: Guidance for building MEDCARE PRO's clinic admin dashboard UI — the design system, its tokens and primitives, and the usability rules for non-technical front-desk staff. Use when building or styling any page under src/app/(dashboard), or any component under src/components/.
---

# Admin Dashboard UI

MEDCARE PRO is an operations tool for front-desk staff at Indian clinics, and a
product an owner shows to their accountant. It has to look like a premium 2026
SaaS application and behave like a till: every visual decision must pay for
itself in speed of use.

The test for any styling choice: *does it make the app feel considered without
slowing down the operator?*

## The design system

Tokens live in `src/app/globals.css`. Primitives live in `src/components/ui/`.
**Do not hand-roll a button, field, table, panel, pill, dialog or avatar
anywhere else** — extend the primitive, so a fix lands once.

### The three rules that hold it together

1. **The page is cool grey, every surface is white.** `--app` (`bg-app`) is the
   canvas; `--bg` (`bg-canvas`) is the white a card, table, sidebar, field or
   popover sits on. A surface separates from the page with a **hairline plus a
   low shadow** — `border border-line shadow-card` — never with a heavy drop
   shadow and never with a second fill.
2. **Elevation is a vocabulary of four**: `shadow-card` (an object on the page),
   `shadow-raised` (that object picked up on hover), `shadow-float` (an overlay
   above it: menu, dialog, drawer, toast), `shadow-cta` (the one primary
   action). If you need a fifth, the design is wrong.
3. **One accent.** A single indigo carries primary action, active state, links
   and the chart line. Status hues are reserved for state that needs a decision.

> **The neumorphic system is gone.** Until the 2026 redesign this app used one
> surface colour for the page and every card, with paired light/dark shadows
> doing the separating. The `--shadow-neu-*` tokens survive only as aliases so
> nothing broke on the day of the change; new code uses the semantic names
> above, and a call site should be migrated when you next touch it.

### Colour tokens

| Token | Job |
|---|---|
| `bg-app` | The page canvas behind everything |
| `bg-canvas` | Every surface: card, table, field, sidebar, popover |
| `bg-canvas-deep` | Wells, table header row, hover fills, segmented backgrounds |
| `border-line` / `border-line-strong` | The hairline that bounds a surface; the stronger one on hover |
| `text-ink` / `text-ink-soft` / `text-muted` / `text-faint` | Headings and numbers · body copy · labels and captions · placeholders only |
| `accent`, `accent-strong`, `accent-soft`, `accent-soft-ink`, `accent-ink` | The one indigo family: fill, hover, tint, text on tint, text on fill |
| `ok` / `warn` / `alert` / `info` (`-bg`, `-line`, `-ink`, `-mark`) | Functional status only |
| `clinic-accent` | A tenant's own colour. **Rails, dots and swatches only** — never behind a label, never a focus ring |

The accent family is themeable (`[data-theme="emerald"]`, `[data-theme="butter"]`,
`[data-theme="dark"]`) via `next-themes`. Never hardcode a Tailwind colour like
`violet-600`; use the tokens and every theme keeps working.

The `--auth-*` family is the **front door only** (/login, /signup,
/verify-email). It is frozen light and un-themeable, and nothing inside the
signed-in app may use it.

### Type

One face, **Plus Jakarta Sans**, loaded via `next/font` in `src/app/layout.tsx`.
Weight does the work a second family used to: 600 for a title, 400 for a caption.

Scale, named by job: `text-micro` (11px caps, column headers) · `text-meta`
(12px, pills and captions) · `text-label` (13px, field and KPI labels) ·
`text-body` (14px, body and table cells) · `text-input` (15px, form controls) ·
`text-section` (17px, card titles) · `text-heading` (22px, section headings) ·
`text-title` (28px, page titles) · `text-metric` / `text-metric-lg` (28/34px, KPI
numbers).

Weights stop at 600. `font-bold` and `font-extrabold` are not used anywhere in
the signed-in app.

### Numbers

- Every number takes `tnum` — KPI values, counts, amounts, times, dates.
- Numeric table columns are right-aligned (`<TD isNumeric>` does both).
- Patient IDs (`PT-2026-0041`) use the `serial` utility.
- Rupee amounts always go through `formatRupees()` in `src/lib/money.ts`.

### Icons

`lucide-react`, imported directly, `strokeWidth={2}`. Two sizes: `h-4 w-4`
beside text, `h-[18px] w-[18px]` or `h-5 w-5` standing alone. Never mix icon
libraries, filled variants or emoji.

### Spacing, radius, motion

Spacing is Tailwind's 4px scale. Conventions: table row `py-3`, form fields
`gap-5`, card padding `p-5`, page gutter `px-4 md:px-6 xl:px-8`, grid gutter
`gap-4`, tap target `min-h-11` (44px, non-negotiable on a tablet).

Radius: `rounded-lg` (10px) chips · `rounded-xl` (12px) dense controls ·
`rounded-2xl` (14px) buttons, inputs, nav items · `rounded-3xl` (18px) cards,
panels, tables · `rounded-4xl` (22px) large containers · `rounded-full` pills.

Motion: 150–200ms on colour, shadow and border. A press is `translate-y-px`. No
parallax, no entrance animations on data, nothing that delays a workflow. The
reduced-motion rule in `globals.css` flattens all of it.

## The primitives

`Button` / `buttonClasses` · `IconButton` · `Input` / `Textarea` / `Select` ·
`Card` · `Panel` · `PageHeader` (+ `Breadcrumbs`, `Count`) · `Table` (+ `THead`,
`TBody`, `TR`, `TH`, `TD`) · `StatusPill` · `Avatar` · `MetricCard` ·
`EmptyState` · `Skeleton` (+ `SkeletonText`, `TableSkeleton`, `MetricSkeleton`) ·
`Modal` (+ `ConfirmDialog`) · `Drawer` · `Menu` · `TabNav` · `FilterBar` ·
`Pagination` · `Toggle` · `Toast`.

Rules of use:

- **One primary action per screen.** Everything else is `secondary` or `ghost`.
  `danger` is a bordered surface with red text; `dangerSolid` is only for the
  confirm button inside a `ConfirmDialog`.
- **Cards are not for everything.** KPIs, summaries, analytics, grouped
  settings. A long list goes in a `Table`, which is its own surface. Never nest
  a card in a card in a card.
- **The dashboard may be expressive; operational screens are utilitarian.** Do
  not propagate the dashboard's card treatment into every table and form.
- **Every list needs all four states**: loaded, empty (`EmptyState`), loading
  (a `loading.tsx` with skeletons), and error (the route group's `error.tsx`).
- **Destructive actions confirm** through `ConfirmDialog`, never `window.confirm`.
- **Filters go through `FilterBar`**, which renders its controls once and turns
  into a sheet on a phone.

## Layout

The shell is `src/app/(dashboard)/layout.tsx`: a fixed 268px sidebar, a sticky
header, and a canvas capped at 1500px. The sidebar answers "what is in this
product"; the header answers "whose data am I looking at, and who am I". Nothing
appears in both — the clinic switcher is in the header only, navigation in the
sidebar only.

Every page starts with a `PageHeader`: breadcrumbs on leaf screens only, a title,
a one-line description in the product's vocabulary, `scope` where the numbers
belong to a clinic, and the page's actions on the right.

## Ground rules

- **Use the PRD's vocabulary exactly**: Registration, Visit, Visit Type, Patient
  ID, Department, Clinic, Notification, Role, Appointment, Service.
- **Appointment is not a synonym for Registration.** An Appointment is a slot
  booked in a doctor's day; a Registration is the visit it becomes when the
  patient arrives and it is converted (AP-5). The schema, the `appointment:*`
  permissions, the API routes and the audit actions all use the same split.
- **Clinic scope must always be legible.** If a screen's numbers cover one
  clinic, say which; if they cover the account, say "All clinics". Never add a
  second clinic filter where the header switcher already governs scope.
- **Role-aware, but never role-secured.** Hiding a control is a courtesy; the
  page and the API behind it enforce. Never remove a server-side check because
  the button is hidden.
- **Sentence case on every label.** "Book appointment", "New registration" — not
  Title Case, and never "Submit".
- **Numbers stay legible.** Right-align numeric columns, always `tnum`.

## Forms

- Inline validation, not only on submit; client rules mirror the server's zod
  schema and never invent a rule the API does not enforce.
- Labels are always visible. Placeholders are examples, not labels.
- Pre-fill what is already known (patient lookup by phone number).
- Long workflows are full pages; a modal or drawer is for a short task.
- Confirm the write with a success toast in the same words as the button.

## Status vocabulary

Use `StatusPill` with these tones:

| Meaning | Tone |
|---|---|
| Delivered, active, verified, paid, completed | `ok` |
| Queued, pending, unread, waiting | `warn` |
| Failed, blocked, rejected, cancelled | `alert` |
| Scheduled, informational, no action attached | `info` |
| A neutral fact (visit type, role name) | `neutral` |
| The current selection, and "confirmed" | `accent` |

## When in doubt

Ask: "Does this look like one product with every other screen, and can a
receptionist finish the task mid-rush?" If not, refine it.
