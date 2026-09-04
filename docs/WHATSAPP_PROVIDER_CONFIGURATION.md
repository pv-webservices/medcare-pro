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

## Platform setup

1. A Superadmin opens **Platform Console → Organisations → WhatsApp integration**.
2. Add the separately purchased RkvRobo account, API key, device limit, and activation state.
3. The encrypted API key is never shown again; replacement requires entering a new value.

## Organisation administrator setup

1. Open **Settings → WhatsApp provider**.
2. Connect each purchased number and scan the returned QR in WhatsApp.
3. Refresh status until RkvRobo positively reports `CONNECTED`.
4. Choose the organisation primary and optional backup device.
5. Enable automatic failover only when a backup is configured.
6. Add clinic overrides only where a clinic must send from another device.
7. Generate each device's webhook URL and manually paste it into RkvRobo.

Runtime routing is deterministic. A clinic override is always used directly and
never inherits the organisation backup. An inherited organisation primary uses
the backup only when failover is enabled, the primary is positively
`DISCONNECTED`, and the backup is positively `CONNECTED`. `UNKNOWN` does not
trigger switching. After a send is submitted, timeout, 5xx, network failure, or
an unreadable response is recorded as failure and is never retried through the
backup. Disabled accounts and devices are never selected. `sender="rotate"` is
not accepted.

The database allows multiple `WhatsappProviderAccount` rows for a tenant. There
is intentionally no unique constraint on `tenant_id` in that table.

## Deployment order

1. Back up the database.
2. Add `WHATSAPP_PROVIDER_ENCRYPTION_KEY` to the deployment secret store.
3. Apply Prisma migration `20260904120000_multi_tenant_whatsapp_provider_config`.
4. Deploy the application.
5. Superadmin enters provider accounts in the Platform Console.
6. Organisation administrators connect devices and configure routing.
7. Perform the first real message manually from the Messaging screen.

The former `WHATSAPP_BSP_API_KEY`, `WHATSAPP_BSP_SENDER`, and
`WHATSAPP_BSP_API_BASE_URL` values are not read by application send paths. The
deprecated reader remains only for legacy standalone diagnostic scripts until
those scripts are retired.

## Webhook migration

The legacy `/api/whatsapp/webhook?token=<WHATSAPP_WEBHOOK_TOKEN>` route remains
temporarily and can update only by globally unique provider message ID. It does
not accept a tenant, clinic, or device identifier. For each device, generate a
new URL in Settings and paste it into the RkvRobo Webhook URL field. The new
`/api/whatsapp/webhook/<publicId>?token=<secret>` route derives device ownership
from the database, verifies the hashed per-device secret in constant time, and
scopes updates to that device. After every production device has delivered a
verified callback through its new URL, clear `WHATSAPP_WEBHOOK_TOKEN`; a later
release may remove the legacy route.

## Manual acceptance after deployment

1. Superadmin configures one organisation's provider account with limit 2.
2. Organisation admin connects Device A by QR and confirms `CONNECTED`.
3. Set Device A primary; manually send text, image, video, and PDF messages.
4. Connect Device B, set it backup, and refresh both statuses.
5. Enable failover, positively disconnect Device A, then manually verify one
   message uses Device B. Do not simulate failover with a timeout.
6. Confirm message history stores Device B and its immutable sender number.
7. Generate Device A and Device B webhook URLs, paste them into RkvRobo, and
   verify callbacks are accepted only by their matching URLs.
8. Confirm the organisation UI never shows an API key, ciphertext, or key
   version.
