# Multi-tenant WhatsApp provider configuration

MedCarePro treats RkvRobo as a device gateway, not as Meta Cloud API or a Meta
BSP. Each organisation supplies its own separately purchased RkvRobo account.
The application does not call `/create-user` and does not provision reseller
sub-users.

## Deployment prerequisite

Set `WHATSAPP_PROVIDER_ENCRYPTION_KEY` to a stable random 32-byte key before an
administrator saves or uses provider credentials:

```sh
openssl rand -base64 32
```

Keep that key in the deployment secret store and in a protected backup. API
keys are AES-256-GCM encrypted with it and bound to both tenant and provider
account IDs. Rotating the deployment key requires re-encrypting existing rows
or entering each provider API key again.

## Administrator setup

1. Open **Settings → WhatsApp provider**.
2. Add the organisation's RkvRobo account and API key.
3. Add each purchased device by its WhatsApp phone number with country code.
4. Choose the organisation default device.
5. Add clinic overrides only where a clinic must send from another device.

Runtime routing is deterministic: clinic override first, organisation default
second. Disabled accounts and devices are never selected. `sender="rotate"` is
not accepted.

The database allows multiple `WhatsappProviderAccount` rows for a tenant. There
is intentionally no unique constraint on `tenant_id` in that table.

## Deployment order

1. Back up the database.
2. Add `WHATSAPP_PROVIDER_ENCRYPTION_KEY` to the deployment secret store.
3. Apply Prisma migration `20260904120000_multi_tenant_whatsapp_provider_config`.
4. Deploy the application.
5. Enter each tenant's account, devices, and routing in Settings.
6. Perform the first real message manually from the Messaging screen.

The former `WHATSAPP_BSP_API_KEY`, `WHATSAPP_BSP_SENDER`, and
`WHATSAPP_BSP_API_BASE_URL` values are not read by application send paths. The
deprecated reader remains only for legacy standalone diagnostic scripts until
those scripts are retired.
