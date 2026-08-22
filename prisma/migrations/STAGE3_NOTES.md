# Stage 3 — clinic registration and approval

## Migration in this stage

`20260822120000_stage3_slug_required` — one statement:

```sql
ALTER TABLE `tenants` MODIFY COLUMN `slug` VARCHAR(191) NOT NULL;
```

Deferred from the Stage 1 constrain migration, which said in its own comments
that Stage 3 would make this change once signup generated a slug itself. It now
does, inside the same transaction that creates the tenant, and
`ensurePlatformTenant()` has always supplied one — so no code path can produce a
NULL any more.

### Before applying

```sql
SELECT COUNT(*) FROM tenants WHERE slug IS NULL;   -- must be 0
```

The Stage 1 backfill filled every pre-existing row. If the count is not zero,
**stop**: the ALTER will fail under MySQL's default strict mode, which is the
correct outcome. Do not convert NULLs to `''` — `tenants_slug_key` is UNIQUE and
the second such row would collide.

### Run order

```
npx prisma migrate deploy      # applies 20260822120000_stage3_slug_required
npx prisma db seed             # ensures the feature catalogue and default plan exist
npm run verify:stage3          # localhost only
```

`prisma db seed` matters more than usual this stage: approval requires a plan,
and `seedFeatureCatalogue` is what creates the `standard` plan and the feature
rows the Owner ticks. On a database where it has never run, the approval screen
has nothing to offer.

## Behaviour changes worth knowing

- **Signup no longer grants a role.** The account-wide role is assigned when the
  Platform Owner approves (`src/lib/platform/decisions.ts`). Existing tenants are
  untouched; this affects new registrations only.
- **The first user gets the `OWNER` role, not `CLINIC_ADMIN`.** Decided
  explicitly: `src/lib/roles.ts` treats the account-wide `*` holder as the
  lockout anchor and refuses to mint `*` through the role editor, so a tenant
  whose only admin held `CLINIC_ADMIN` could never have an owner at all.
- **Login now also requires the individual's own `users.email_verified_at`,**
  not only the organisation's. The Stage 1 backfill filled that column for every
  pre-existing user, so no existing login is affected.
- **A refused session no longer loops.** A valid JWT whose database check fails
  used to bounce `/dashboard → /login → /dashboard` forever, because the
  middleware can only see the token. The dashboard shell now routes by reason,
  and `/login?ended=1` is exempt from the signed-in bounce.

## Still carried forward

Both items in `STAGE1_NOTES.md` remain binding and neither is done:

- **Before Stage 4** — `login_codes.code_hash` must not hold a plain unsalted
  SHA-256 digest. See the acceptance criteria there. **This is the next stage.**
- ~~**Before Stage 8** — the role-level feature default must key off
  `Feature.tier`.~~ **Done in Stage 8**, while `role_feature_access` was still
  empty. See the resolution note in `STAGE1_NOTES.md`.
