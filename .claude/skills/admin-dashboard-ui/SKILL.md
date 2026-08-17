---
name: admin-dashboard-ui
description: Guidance for building MEDCARE PRO's clinic admin dashboard UI — the design system, its tokens and primitives, and the usability rules for non-technical front-desk staff. Use when building or styling any page under src/app/(dashboard), or any component under src/components/.
---

# Admin Dashboard UI

MEDCARE PRO is an internal operations tool for front-desk staff at Indian clinics. It must balance a premium, "gorgeous but usable" aesthetic with the strict operational discipline required for speed of use during a busy front desk.

## Polish vs. discipline — how they reconcile

The design brief is **"gorgeous but usable."** This means we employ modern, premium aesthetics—vibrant but harmonious color palettes, smooth micro-animations, sleek interactive states, and excellent typography—while maintaining usability.

- Polish that **serves the eye's path** — type hierarchy, tabular alignment, surface separation, smooth gradients, consistent row rhythm, generous tap targets, and micro-animations for hover/active states — is required. It makes the interface feel responsive, alive, and premium.
- However, **every visual decision must pay for itself in speed of use**. A design system that is stunning must also be legible, consistent, and quick to scan. Decorative elements must not compromise data density or readability.

The test for any styling choice: *does it make the app feel premium without slowing down the operator?* 

## The design system

Tokens live in `src/app/globals.css`. Primitives live in `src/components/ui/`. **Do not hand-roll a button, input, table, panel or pill anywhere else** — extend the primitive instead, so a fix lands once.

### Dynamic Theme Colors

The application supports multiple dynamic themes (e.g., Default/Violet, Emerald, and Butter Yellow) powered by `next-themes` and CSS variables (`[data-theme="emerald"]`, etc.). This completely replaces legacy database-driven `themeColor` logic.

| Token | Job |
|---|---|
| `--primary` | The active theme's primary color (e.g., Violet-600, Emerald-600, Butter Yellow) |
| `--primary-hover` | Darker variant for interactive hover states |
| `--primary-light` | Light background variant for active states, card backgrounds, and icon wrappers |
| `--primary-foreground` | Dynamic text color (white on dark primaries, dark slate on light primaries like Butter) |

Use these tokens (`bg-primary`, `text-primary`, `bg-primary-light`, `text-primary-foreground`) instead of hardcoding Tailwind colors like `violet-600` or `emerald-500`.

### Neutrals and Status Hues

Five neutrals carry the shell:
- `--paper`: Page canvas
- `--surface`: Cards, panels, table body
- `--surface-sunk`: Table headers, selected rows, inset wells
- `--ink`: Primary text
- `--muted`: Labels, secondary text
- `--line`: Rules and borders

Three status hues are **functional signals**:
- `--ok` (delivered, active, verified)
- `--warn` (queued, pending, expiring)
- `--alert` (failed send, validation error, destructive action)

### Type

Two faces, loaded via `next/font` in `src/app/layout.tsx`:

- **Anek Latin** (`font-display`) — headings only. Used at page titles and panel headings, nowhere else.
- **IBM Plex Sans** (`font-sans`) — everything else. Drawn for dense enterprise interfaces, with true tabular figures.

**One hard rule: Anek never touches a digit.** Every number in this app — rupee amounts, patient counts, Patient IDs, dates — is IBM Plex Sans with `tabular-nums`.

Scale: `text-micro` (11px caps) · `text-label` (13px) · `text-body` (15px) · `text-section` (17px) · `text-title` (22px) · `text-metric` (28px).
Inputs are 16px (`text-input`) regardless to prevent iOS Safari zoom.

### Patient IDs and amounts

- Patient IDs (`PT-2026-0041`) use the `serial` utility — tabular figures with open tracking.
- Rupee amounts always go through `formatRupees()` in `src/lib/money.ts` (`₹1,50,000.00`). 

### Icons

`lucide-react`, imported directly. Two sizes only: `h-4 w-4` beside text and `h-5 w-5` or `h-6 w-6` standing alone in KPI cards. Always `strokeWidth={1.75}`.

### Spacing, radius, shadow

Spacing is Tailwind's 4px scale.
Radius: `rounded-sm` (4px) swatches · `rounded-md` (6px) controls · `rounded-xl` / `rounded-2xl` for cards, panels, and modern UI surfaces · `rounded-full` pills.
Shadows: Use soft, modern shadows (`shadow-sm`, `shadow-pop`) to lift cards and interactive elements, providing a premium floating feel.

## Ground rules

- **Gorgeous but usable.** Every screen must look premium while allowing staff to find or record something fast.
- **Use the PRD's vocabulary exactly.** The words are **Registration**, **Visit**, **Visit Type**, **Patient ID**, **Department**, **Clinic**, **Notification**, **Role**. Never soften these into "Booking" or "Appointment" (MEDCARE PRO logs registrations of visits). Never use legacy v1 vocabulary like "IVR".
- **Empty and error states.** Use the `EmptyState` primitive so the pattern stays identical and helpful.
- **Active voice on every action.** A button says what happens: "Add Clinic," "Register Patient" — not "Submit".
- **Dynamic Theming.** Always use the `--primary` family of CSS variables for branding interactive elements. Never hardcode brand colors.
- **Numbers stay legible.** Right-align every numeric column, always `tabular-nums`.

## Forms

- Inline validation, not just on-submit.
- Client validation mirrors the server's zod schema.
- Pre-fill what is already known (e.g., patient lookup by phone number).
- Confirm the write with a success toast.

## Status vocabulary

Use `StatusPill` with these tones:

| Meaning | Tone |
|---|---|
| Delivered, active, verified | `ok` |
| Queued, pending, in progress | `warn` |
| Failed, blocked, destructive | `alert` |
| Neutral fact, no action | `neutral` |

## When in doubt

Ask: "Does this look premium while remaining obvious and fast for a front-desk worker mid-rush?" If not, refine it.
