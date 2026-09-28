const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Format and base-36 checksum only; this does not verify registration or tax treatment. */
export function isValidGstin(value: string): boolean {
  if (!/^(0[1-9]|[12]\d|3[0-8]|97|99)[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(value)) return false;
  let sum = 0;
  for (let index = 0; index < 14; index++) {
    const product = alphabet.indexOf(value[index]) * (index % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + product % 36;
  }
  return alphabet[(36 - sum % 36) % 36] === value[14];
}
