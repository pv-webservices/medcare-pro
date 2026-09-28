import { toPaise } from "./invoiceMath";

const small = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function words(value: number): string {
  if (value < 20) return small[value];
  if (value < 100) return tens[Math.floor(value / 10)] + (value % 10 ? ` ${small[value % 10]}` : "");
  for (const [size, label] of [[10000000, "Crore"], [100000, "Lakh"], [1000, "Thousand"], [100, "Hundred"]] as const) {
    if (value >= size) return `${words(Math.floor(value / size))} ${label}${value % size ? ` ${words(value % size)}` : ""}`;
  }
  throw new RangeError("Invalid amount");
}
export function amountInWords(amount: string): string {
  const paise = toPaise(amount);
  return `Rupees ${words(Math.floor(paise / 100))}${paise % 100 ? ` and Paise ${words(paise % 100)}` : ""} Only`;
}
