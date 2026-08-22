import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import {
  createInvitation,
  createInvitationSchema,
  revokeInvitation,
  revokeInvitationSchema,
} from "@/lib/invitations";
import { readClientIp, readUserAgent } from "@/lib/requestMeta";
import { requireActor } from "@/lib/session";

// Invitations — Stage 6. Issue a link that turns into a login, or withdraw one.
//
// Both verbs need `team:invite`, checked in @/lib/invitations: the permission
// catalogue defines it as "Create and revoke invitations", and splitting them
// would leave someone able to hand out access they could not take back.
//
// The role an invitation names is subject to the same escalation guard as
// assigning it directly (`assertRoleGrantableBy` in @/lib/roles) — an
// invitation is a deferred assignment, not a way around the rule.
//
// Rate limits are per address and per tenant. They are not defending against an
// anonymous attacker, since this route requires a session; they stop our mail
// domain being used to flood one inbox.

export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    const input = createInvitationSchema.parse(await readJsonBody(request));

    const created = await createInvitation(actor, input, {
      ip: readClientIp(request),
      userAgent: readUserAgent(request),
    });

    return jsonOk(created, 201);
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/team/invitations");
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireActor();
    const input = revokeInvitationSchema.parse(await readJsonBody(request));

    return jsonOk(
      await revokeInvitation(actor, input, {
        ip: readClientIp(request),
        userAgent: readUserAgent(request),
      }),
    );
  } catch (error: unknown) {
    return toErrorResponse(error, "PATCH /api/team/invitations");
  }
}
