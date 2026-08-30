import { handleBookingConfirmationInput } from "@/lib/telephony/booking";
import { processBookingWebhook } from "@/lib/telephony/bookingWebhook";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return processBookingWebhook(request, handleBookingConfirmationInput, "booking confirmation");
}
