import { z } from "zod";

export const clinicCapacityRequestSchema = z
  .object({
    requestType: z.enum(["ADDITIONAL_CLINIC", "PLAN_UPGRADE"]),
    requestedQuantity: z.coerce.number().int().min(1).max(100).optional(),
    requestedPlanId: z.string().trim().min(1).max(191).optional(),
    organizationNote: z.string().trim().max(2_000).optional(),
    paymentReference: z.string().trim().max(255).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.requestType === "ADDITIONAL_CLINIC") {
      if (value.requestedQuantity === undefined) {
        context.addIssue({ code: "custom", path: ["requestedQuantity"], message: "Request at least one additional clinic." });
      }
      if (value.requestedPlanId !== undefined) {
        context.addIssue({ code: "custom", message: "Do not submit a plan for an additional-clinic request." });
      }
    } else {
      if (!value.requestedPlanId) {
        context.addIssue({ code: "custom", path: ["requestedPlanId"], message: "Choose a plan to request an upgrade." });
      }
      if (value.requestedQuantity !== undefined) {
        context.addIssue({ code: "custom", message: "Do not submit a quantity for a plan-upgrade request." });
      }
      if (value.paymentReference !== undefined) {
        context.addIssue({ code: "custom", message: "Do not submit a payment reference for a plan-upgrade request." });
      }
    }
  });

export type ClinicCapacityRequestInput = z.infer<typeof clinicCapacityRequestSchema>;
