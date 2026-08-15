# MEDCARE PRO — Project Structure v2
### Supersedes the earlier per-clinic-deployment structure

```
medcare-pro/
│
├── prisma/
│   ├── schema.prisma        # accounts, users, roles, user_roles, clinics, doctors,
│   │                         # doctor_availability, doctor_leave, patients, registrations,
│   │                         # registration_edit_log, notifications, whatsapp_messages
│   └── migrations/
│
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── signup/page.tsx          # FR-1.1
│   │   │   ├── verify-email/page.tsx    # FR-1.2
│   │   │   ├── login/page.tsx           # FR-1.4/1.5
│   │   │   └── layout.tsx
│   │   │
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx               # sidebar/nav + clinic switcher
│   │   │   ├── dashboard/page.tsx        # overview (Stage 2A)
│   │   │   ├── registration/
│   │   │   │   ├── page.tsx              # list, search, filter, export (6.3)
│   │   │   │   ├── new/page.tsx          # create entry
│   │   │   │   └── [id]/
│   │   │   │       ├── page.tsx          # view/edit
│   │   │   │       └── history/page.tsx  # audit trail — admin/owner only
│   │   │   ├── doctors/
│   │   │   │   ├── page.tsx              # list + counts (6.4)
│   │   │   │   └── [id]/page.tsx         # profile, availability calendar, leave
│   │   │   ├── clinics/
│   │   │   │   ├── page.tsx              # list (6.5)
│   │   │   │   └── [id]/page.tsx
│   │   │   ├── reports/
│   │   │   │   └── page.tsx              # revenue report (6.6)
│   │   │   ├── notifications/page.tsx    # (6.7)
│   │   │   ├── messages/page.tsx         # WhatsApp send (6.9)
│   │   │   └── settings/
│   │   │       ├── roles/page.tsx        # role creation/assignment (6.8)
│   │   │       └── branding/page.tsx     # theme + logo (6.8)
│   │   │
│   │   ├── api/
│   │   │   ├── auth/
│   │   │   │   ├── [...nextauth]/route.ts
│   │   │   │   ├── signup/route.ts
│   │   │   │   └── verify-email/route.ts
│   │   │   ├── clinics/route.ts
│   │   │   ├── clinics/[id]/route.ts
│   │   │   ├── doctors/route.ts
│   │   │   ├── doctors/[id]/availability/route.ts
│   │   │   ├── doctors/[id]/leave/route.ts
│   │   │   ├── registrations/route.ts
│   │   │   ├── registrations/[id]/route.ts
│   │   │   ├── registrations/[id]/history/route.ts
│   │   │   ├── reports/revenue/route.ts
│   │   │   ├── notifications/route.ts
│   │   │   ├── roles/route.ts
│   │   │   └── whatsapp/
│   │   │       ├── send/route.ts
│   │   │       └── webhook/route.ts
│   │   │
│   │   ├── layout.tsx
│   │   └── globals.css
│   │
│   ├── components/
│   │   ├── dashboard/ | registration/ | doctors/ | clinics/ | reports/ | ui/
│   │
│   ├── lib/
│   │   ├── prisma.ts
│   │   ├── auth.ts
│   │   ├── email.ts              # verification emails
│   │   ├── whatsapp.ts           # third-party BSP wrapper
│   │   ├── rbac.ts               # permission-check helper, used in every API route
│   │   └── utils.ts
│   │
│   └── types/
│
├── public/
├── .env.example        # DATABASE_URL, NEXTAUTH_SECRET, EMAIL_*, WHATSAPP_BSP_*
├── next.config.js
├── tailwind.config.ts
├── package.json
└── README.md
```

## What changed from v1

- No more per-clinic deployment — this is the entire application, one deployment.
- `patients/` renamed conceptually to `registration/` to match the client's terminology, but the underlying `Patient` and `Registration` are separate tables (a patient can have multiple registrations/visits).
- Added `signup`, `verify-email`, `clinics`, `doctors`, `reports`, `notifications`, `settings/roles`, `settings/branding`.
- `lib/twilio.ts` and `api/twilio/*` removed — IVR is out of MVP scope.
- `lib/rbac.ts` is new and required — every mutating API route must call it.