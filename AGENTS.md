# MedCare Pro Engineering Rules

## Plivo / Telephony

1. Before implementing or modifying Plivo-specific Voice, XML, IVR, DTMF, Dial, webhook, call-transfer, SIP, or telephony behavior, consult the configured Plivo MCP `search_plivo` tool.
2. Prefer current Plivo documentation over remembered API syntax.
3. Never expose `PLIVO_AUTH_ID`, `PLIVO_AUTH_TOKEN`, SIP passwords, or provider secrets to browser/client code, logs, responses, tests using real values, MCP configuration, or source control.
4. Consider every inbound Plivo webhook untrusted until V3 signature validation succeeds.
5. Do not introduce a production bypass for Plivo signature verification.
6. Keep Plivo transport and XML logic under the telephony layer. Do not embed Plivo SDK calls directly inside appointment domain services.
7. Reuse existing MedCare appointment availability and booking domain logic. Never build a separate appointment engine for IVR.
8. Telephone appointment booking must reuse the existing `DoctorScheduleLock` concurrency protection.
9. Any Plivo callback that produces a persistent side effect must be idempotent. Before appointment booking is enabled through an action callback, design an idempotency key using `CallUUID` plus the relevant IVR/action context.
10. Do not trust caller phone number as unique patient identity. Multiple patients may share a phone number.
11. Never create appointments using placeholder patient names merely because caller identification is ambiguous.
12. Do not introduce AI voice, speech recognition, recording, VideoSDK, or another telephony provider unless explicitly requested.
13. Recording remains off by default.

## Initial IVR Scope

The deterministic V1 menu is:

- `1` -> tomorrow slots
- `2` -> appointment booking
- `3` -> urgent assistance
- `4` -> clinic information
- `9` -> repeat menu

Do not expand this scope without explicit approval.

## Emergency Handling

Do not provide AI medical diagnosis or emergency triage. The urgent/emergency flow must eventually provide appropriate emergency guidance and may transfer to a configured clinic on-call destination.

## Testing

For telephony changes:

- Run focused Plivo unit tests.
- Run `npm run typecheck`.
- Lint all touched files.
- Never perform paid Plivo calls automatically.
- Never buy or rent numbers automatically.
- Never modify Plivo billing automatically.
- Treat real phone calls as manual acceptance tests.
- Do not place real secrets in test fixtures.
