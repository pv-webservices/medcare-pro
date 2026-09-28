/** Issue instants use India time, unlike registration wall-clock timestamps. */
export function financialYearFor(instant: Date): string {
  if (!Number.isFinite(instant.getTime())) throw new RangeError("Invalid issue instant");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "numeric",
  }).formatToParts(instant);
  const year = Number(parts.find((part) => part.type === "year")!.value);
  const month = Number(parts.find((part) => part.type === "month")!.value);
  const start = month < 4 ? year - 1 : year;
  return `${String(start % 100).padStart(2, "0")}${String((start + 1) % 100).padStart(2, "0")}`;
}
