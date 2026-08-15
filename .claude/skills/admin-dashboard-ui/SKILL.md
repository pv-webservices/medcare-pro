---
name: admin-dashboard-ui
description: Guidance for building MEDCARE PRO's clinic admin dashboard UI — clarity and usability for non-technical front-desk staff. Use when building or styling any page under app/(dashboard), or any component in components/dashboard, components/patients, components/messages.
---

# Admin Dashboard UI

This is an internal operations tool for front-desk clinic staff, not a marketing
site. Optimize for speed of use during a busy front desk, not visual flair.

## Ground rules

- **Data-first, not decoration-first.** Every screen's job is to let staff find
  or record something fast. No hero sections, no marketing copy, no illustration
  filler.
- **Use the PRD's vocabulary exactly.** "Patient," "Appointment," "Working
  Hours" — never rename these to generic terms like "Record" or "Entry" in the
  UI. Staff should never have to translate the interface's words into the
  clinic's words.
- **Empty and error states are functional, not cute.** "No appointments logged
  today yet" beats an illustration with no explanation. Every error state says
  what happened and what to do next — never a bare "Something went wrong."
- **Active voice on every action.** A button says what happens: "Send
  Reminder," "Log Appointment" — not "Submit" or "Confirm."
- **Color is functional, not decorative.** Reserve strong color (e.g. red/amber)
  for things needing action — a pending IVR notification, a failed WhatsApp
  send. Don't apply accent colors to elements with no status meaning.
- **Numbers stay legible.** Revenue and patient counts on the dashboard should
  be the largest, highest-contrast text on the page — they're the first thing
  staff check each morning.
- **Design for a tablet at a front desk**, not just a widescreen monitor.
  Tap targets large enough for a shared front-desk device; test at ~768px
  width, not just desktop and mobile.
- **Consistency over novelty.** Reuse the same table/list pattern for patients,
  appointments, and IVR logs. Staff should recognize a pattern once and reuse
  that knowledge everywhere.

## Forms

- Inline validation, not just on-submit — a bad phone number should be flagged
  as the staff member types, not after they hit save.
- Pre-fill what's already known (e.g. picking a patient for an appointment
  should pull their existing phone number, not ask for it again).

## When in doubt

Ask: "Would a front-desk worker mid-rush find this obvious in under 2
seconds?" If not, simplify — don't add an explanation, remove the ambiguity.