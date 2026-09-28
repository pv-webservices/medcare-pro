/** POST to a billing route; surfaces the API's own message and never clears the caller's form. */
export async function postBilling<T = unknown>(url: string, body: unknown, fallback: string): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success) throw new Error(result?.error || fallback);
  return result.data as T;
}
