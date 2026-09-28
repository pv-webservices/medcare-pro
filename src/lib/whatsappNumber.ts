/**
 * The WhatsApp number a stored mobile number actually reaches — digits only,
 * with India's country code added to a bare 10-digit number, e.g.
 * "+91 98123-45678" and "9812345678" both become "919812345678".
 *
 * Kept free of server imports so the composer can use the same rule to spot
 * two patient records that share a phone.
 */
export function toWhatsappDigits(mobileNumber: string): string {
  // Anything the front desk typed for readability — spaces, +, hyphens,
  // brackets — is stripped.
  const digits = mobileNumber.replace(/\D/g, "");

  return digits.length === 10 ? `91${digits}` : digits;
}
