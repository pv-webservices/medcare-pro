import { z } from "zod";

/**
 * The clinic registration form contract — Stage 3.
 *
 * Stage 3 widens FR-1.1's two-field signup (business name + email) to the full
 * application an Owner has to judge. The schema lives here rather than inline in
 * the route so the client form, the route and the unit tests share one
 * definition and cannot drift apart.
 *
 * FIELD MAPPING — the Stage 3 brief's field list onto the Stage 1 columns:
 *
 *   Name                     -> User.name          (the applicant, a person)
 *   Email                    -> Tenant.email AND User.email (identical at signup)
 *   Clinic name              -> Tenant.businessName
 *   City                     -> Tenant.city
 *   Phone number             -> Tenant.phone and User.phone
 *   Optional address         -> Tenant.address
 *   Optional business info   -> Tenant.primaryContactEmail
 *   Terms/privacy consent    -> Tenant.termsAcceptedAt
 *
 * The last mapping is the one to know about: the schema has no free-text
 * "business information" column, and Stage 1's only spare business-detail field
 * is `primaryContactEmail` — an address a business may want to differ from the
 * one it logs in with (billing@, admin@). It is display/notification only and is
 * NEVER an identity, login or verification input; `Tenant.email` remains the
 * single identity key. Adding a column instead would have meant inventing a
 * field the PRD does not list.
 *
 * Pure apart from Zod: no Prisma, no session.
 */

/** Unchanged from the pre-Stage-3 route — the project's existing stance. */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;

export const MAX_NAME_LENGTH = 120;
export const MAX_CLINIC_NAME_LENGTH = 255;
export const MAX_CITY_LENGTH = 120;
export const MAX_PHONE_LENGTH = 32;
export const MAX_ADDRESS_LENGTH = 1000;
export const MAX_EMAIL_LENGTH = 255;

/**
 * Strictly enforce Indian phone numbers for this product.
 * Formats allowed: 9599995599, +919599995599
 */
const PHONE_ALLOWED = /^(\+91)?[0-9]{10}$/;

const phoneField = z
  .string()
  .trim()
  .min(1, "Phone number is required")
  .max(13) // max length for +919599995599
  .regex(PHONE_ALLOWED, "Enter a valid 10-digit Indian phone number (e.g. 9599995599 or +919599995599).");

/**
 * An optional text field. The empty string is what an untouched form input
 * posts, and it means "not provided" — not "provided as blank" — so it is
 * accepted and normalised to null rather than rejected.
 */
const optionalText = (max: number) => z.string().trim().max(max).optional();

export const signupSchema = z.object({
  name: z.string().trim().min(1, "Your name is required").max(MAX_NAME_LENGTH),
  email: z.email("Enter a valid email address.").max(MAX_EMAIL_LENGTH),
  clinicName: z
    .string()
    .trim()
    .min(1, "Clinic name is required")
    .max(MAX_CLINIC_NAME_LENGTH),
  city: z.string().trim().min(1, "City is required").max(MAX_CITY_LENGTH),
  phone: phoneField,
  address: optionalText(MAX_ADDRESS_LENGTH),
  /** Optional business contact address — see the FIELD MAPPING note above. */
  businessEmail: optionalText(MAX_EMAIL_LENGTH),
  password: z
    .string()
    .min(
      MIN_PASSWORD_LENGTH,
      `Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    )
    .max(MAX_PASSWORD_LENGTH),
  /**
   * Stage 3 requires an explicit consent. `.refine` rather than `z.literal(true)`
   * so that `false` — which is what an unticked checkbox posts — produces the
   * written message instead of a type error.
   */
  acceptTerms: z
    .boolean()
    .refine(
      (value) => value === true,
      "You must accept the terms and privacy policy.",
    ),
});

export type SignupInput = z.infer<typeof signupSchema>;

/** What the route actually writes: emails lowercased, blanks turned into nulls. */
export interface NormalizedSignup {
  name: string;
  email: string;
  clinicName: string;
  city: string;
  phone: string;
  address: string | null;
  businessEmail: string | null;
  password: string;
}

function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Normalises a parsed form. Split from the schema so the transformation is
 * testable on its own and so the schema stays a plain description of the shape.
 *
 * `businessEmail` is validated here rather than in the schema because Zod's
 * optional-email handling would reject the empty string an untouched input
 * posts. A non-empty value that is not an address is rejected; blank is null.
 */
export function normalizeSignupInput(input: SignupInput): NormalizedSignup {
  const businessEmail = blankToNull(input.businessEmail);

  if (businessEmail !== null && !z.email().safeParse(businessEmail).success) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["businessEmail"],
        message: "Enter a valid business email address, or leave it blank.",
        input: businessEmail,
      },
    ]);
  }

  return {
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    clinicName: input.clinicName.trim(),
    city: input.city.trim(),
    phone: input.phone.trim(),
    address: blankToNull(input.address),
    businessEmail: businessEmail === null ? null : businessEmail.toLowerCase(),
    password: input.password,
  };
}
