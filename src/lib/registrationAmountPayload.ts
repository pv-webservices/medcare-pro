/** Existing registration API uses numbers; omit only unchanged EDIT amounts. */
export function registrationAmountPayload(isEdit: boolean, amount: string, initialAmount?: string): { amount?: number } {
  return isEdit && initialAmount !== undefined && Number(amount) === Number(initialAmount)
    ? {} : { amount: Number(amount) };
}
