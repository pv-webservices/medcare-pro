import { z } from "zod";

/**
 * Standardized patient demographics contract across MEDCARE PRO.
 *
 * Shared by:
 * - New Patient Registration (/registration/new)
 * - Book Appointment (/appointments/new)
 * - Patient Edit & History
 */

export const GENDER_OPTIONS = ["Male", "Female", "Other"] as const;
export type GenderOption = (typeof GENDER_OPTIONS)[number];

export const MOBILE_REGEX = /^(\+91)?[0-9]{10}$/;

export const patientNameSchema = z
  .string()
  .trim()
  .min(1, "Enter the patient's name.")
  .max(255, "That name is too long.");

export const patientMobileSchema = z
  .string()
  .trim()
  .regex(MOBILE_REGEX, "Mobile number must be a valid 10-digit Indian number.")
  .max(13);

export const patientAgeSchema = z.coerce
  .number({
    message: "Enter an age between 0 and 150.",
  })
  .int("Enter an age between 0 and 150.")
  .min(0, "Enter an age between 0 and 150.")
  .max(150, "Enter an age between 0 and 150.");

export const patientGenderSchema = z.enum(GENDER_OPTIONS, {
  message: "Select a gender.",
});

export const patientCitySchema = z
  .string()
  .trim()
  .min(1, "Enter the patient's city.")
  .max(255, "That city is too long.");

export const patientAddressSchema = z
  .string()
  .trim()
  .min(1, "Enter the patient's address.")
  .max(1000, "That address is too long.");

export interface PatientFormValues {
  name: string;
  mobileNumber: string;
  age: string;
  gender: string;
  city: string;
  address: string;
}

export type PatientFieldErrors = Partial<Record<keyof PatientFormValues, string>>;

/**
 * Validates the 6 mandatory patient-detail fields for client forms.
 */
export function validatePatientDetails(values: PatientFormValues): PatientFieldErrors {
  const errors: PatientFieldErrors = {};

  if (!values.name || values.name.trim().length === 0) {
    errors.name = "Enter the patient's name.";
  }

  const trimmedMobile = values.mobileNumber ? values.mobileNumber.trim() : "";
  if (!trimmedMobile || !MOBILE_REGEX.test(trimmedMobile)) {
    errors.mobileNumber = "Mobile number must be a valid 10-digit Indian number.";
  }

  const trimmedAge = values.age ? values.age.trim() : "";
  if (!trimmedAge) {
    errors.age = "Enter the patient's age.";
  } else {
    const ageNum = Number(trimmedAge);
    if (!Number.isInteger(ageNum) || ageNum < 0 || ageNum > 150) {
      errors.age = "Enter an age between 0 and 150.";
    }
  }

  const trimmedGender = values.gender ? values.gender.trim() : "";
  if (!trimmedGender || !GENDER_OPTIONS.includes(trimmedGender as GenderOption)) {
    errors.gender = "Select a gender.";
  }

  if (!values.city || values.city.trim().length === 0) {
    errors.city = "Enter the patient's city.";
  }

  if (!values.address || values.address.trim().length === 0) {
    errors.address = "Enter the patient's address.";
  }

  return errors;
}

/**
 * Normalizes returning patient gender to match standard TitleCase GENDER_OPTIONS.
 */
export function normalizeGender(gender?: string | null): string {
  if (!gender) return "";
  const clean = gender.trim().toLowerCase();
  if (clean === "male" || clean === "m") return "Male";
  if (clean === "female" || clean === "f") return "Female";
  if (clean === "other" || clean === "o") return "Other";
  return "";
}
