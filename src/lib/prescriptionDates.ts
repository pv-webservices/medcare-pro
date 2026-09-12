/** Issuance is an instant; visitDate remains the existing UTC-tagged wall clock.
 * Match the application's explicit India issuance display for date filters.
 */
export function prescriptionIssuedDateBounds(from?: string, to?: string) {
  return {
    ...(from ? { gte: new Date(`${from}T00:00:00+05:30`) } : {}),
    ...(to
      ? { lt: new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 86400000) }
      : {}),
  };
}
