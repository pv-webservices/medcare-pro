# Automated Clinic Management System
### Project Structure

This is the template structure for **one clinic instance**. Per the multi-tenant decision, this exact codebase gets cloned and deployed separately for each clinic, each pointing at its own `DATABASE_URL`.

```
clinic-management-system/
│
├── prisma/
│   ├── schema.prisma              # All DB models: User, Patient, Appointment, ClinicSettings, IvrLog
│   └── migrations/                # Auto-generated migration history
│
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── login/
│   │   │   │   └── page.tsx       # Admin login screen
│   │   │   └── layout.tsx
│   │   │
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx         # Shared sidebar/nav for all admin pages
│   │   │   ├── dashboard/
│   │   │   │   └── page.tsx       # Revenue + patient counters (Stage 2)
│   │   │   ├── patients/
│   │   │   │   ├── page.tsx       # Patient list + search
│   │   │   │   └── [id]/page.tsx  # Single patient record
│   │   │   ├── appointments/
│   │   │   │   └── page.tsx       # Appointment log (Stage 1)
│   │   │   ├── messages/
│   │   │   │   └── page.tsx       # WhatsApp template sender (Stage 3)
│   │   │   └── receptionist/
│   │   │       └── page.tsx       # Working hours + IVR toggle + call log (Stage 4)
│   │   │
│   │   ├── api/
│   │   │   ├── auth/[...nextauth]/route.ts    # Auth.js handler
│   │   │   ├── patients/route.ts              # Patient CRUD
│   │   │   ├── appointments/route.ts          # Appointment CRUD
│   │   │   ├── clinic-settings/route.ts       # Working hours / toggle
│   │   │   ├── whatsapp/
│   │   │   │   ├── send/route.ts              # Fires template message via Meta API
│   │   │   │   └── webhook/route.ts           # Delivery status callbacks
│   │   │   └── twilio/
│   │   │       ├── voice/route.ts             # Incoming call → TwiML response
│   │   │       └── gather/route.ts            # Captures DTMF keypress → writes ivr_logs
│   │   │
│   │   ├── layout.tsx
│   │   └── globals.css
│   │
│   ├── components/
│   │   ├── dashboard/              # Revenue/patient counter cards
│   │   ├── patients/                # Patient table, patient form
│   │   ├── messages/                # Template picker, send button
│   │   └── ui/                      # Shared buttons, inputs, modals
│   │
│   ├── lib/
│   │   ├── prisma.ts                # Prisma client singleton
│   │   ├── auth.ts                  # Auth.js config
│   │   ├── whatsapp.ts              # Meta Cloud API wrapper
│   │   ├── twilio.ts                # Twilio client + TwiML helpers
│   │   └── utils.ts
│   │
│   └── types/                       # Shared TypeScript types
│
├── public/                          # Clinic logo slot, static assets
├── .env.example                     # DATABASE_URL, NEXTAUTH_SECRET, WHATSAPP_TOKEN, TWILIO_* keys
├── next.config.js
├── tailwind.config.ts
├── package.json
└── README.md
```

## How This Maps to the Feature Stages

| Stage | Folder(s) |
|---|---|
| Stage 1 — Patient & Appointment Records | `app/(dashboard)/patients`, `app/(dashboard)/appointments`, `api/patients`, `api/appointments` |
| Stage 2 — Live Dashboard | `app/(dashboard)/dashboard`, `components/dashboard` |
| Stage 3 — WhatsApp Communication | `app/(dashboard)/messages`, `api/whatsapp`, `lib/whatsapp.ts` |
| Stage 4 — Smart Receptionist (IVR) | `app/(dashboard)/receptionist`, `api/twilio`, `lib/twilio.ts` |
| Stage 5 — Secure Per-Clinic Setup | `.env.example` (per-deployment `DATABASE_URL`), `lib/auth.ts` |

## Per-Clinic Cloning Convention

Each new clinic gets:
- A fresh copy of this repo (or a shared repo with a clinic-specific branch/deployment)
- Its own `DATABASE_URL` pointing to a dedicated Hostinger MySQL database
- Its own `NEXTAUTH_SECRET` and admin credentials
- Its own subdomain or URL (e.g. `clinicname.yourdomain.com`)

---

Ready for PRD and SOP whenever you are.
