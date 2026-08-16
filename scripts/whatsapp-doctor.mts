/**
 * WhatsApp connectivity check — READ ONLY, against the LIVE gateway.
 *
 *     npm run whatsapp:doctor
 *     npm run whatsapp:doctor -- 919812345678    # also check one number
 *
 * Answers "is WhatsApp actually working?" without sending anything. It calls
 * only `/info-devices` and `/check-number`, both of which read; there is no
 * code path here that can deliver a message to anyone.
 *
 * Run it after changing the API key, after reconnecting a device, or when the
 * front desk reports that sends are failing.
 *
 * Secrets are never printed — only whether they are set, and their last four
 * characters, so a wrong-key mix-up is still diagnosable.
 */
import {
  checkNumber,
  getDeviceStatus,
  isWhatsappConfigured,
  readWhatsappConfig,
  ROTATE_SENDER,
} from "@/lib/whatsapp";

// tsx does not read .env by itself. The verify scripts get it as a side effect
// of importing Prisma, which loads it for the datasource; this one never
// touches the database, so it loads the file itself. Values already present in
// the shell win, which is what loadEnvFile does.
try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the variables may legitimately come from the environment.
}

let problems = 0;

function ok(label: string, detail = ""): void {
  console.log(`  OK    ${label}${detail ? ` — ${detail}` : ""}`);
}

function warn(label: string, detail = ""): void {
  console.log(`  WARN  ${label}${detail ? ` — ${detail}` : ""}`);
}

function fail(label: string, detail = ""): void {
  problems += 1;
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
}

function tail(value: string): string {
  return value.length <= 4 ? "****" : `…${value.slice(-4)}`;
}

async function main(): Promise<void> {
  console.log("\nConfiguration");

  if (!isWhatsappConfigured()) {
    fail(
      "WhatsApp is not configured",
      "set WHATSAPP_BSP_API_KEY and WHATSAPP_BSP_SENDER",
    );
    return;
  }

  const config = readWhatsappConfig();
  ok("API key set", `${config.apiKey.length} chars, ${tail(config.apiKey)}`);
  ok("Base URL", config.baseUrl);
  ok("Sending device", config.sender);

  const webhookToken = (process.env.WHATSAPP_WEBHOOK_TOKEN ?? "").trim();
  if (webhookToken === "") {
    warn(
      "No webhook token",
      "delivery callbacks will be rejected (fails closed, by design)",
    );
  } else if (webhookToken.length < 24) {
    warn("Webhook token is short", "use at least 32 hex chars: openssl rand -hex 32");
  } else {
    ok("Webhook token set", `${webhookToken.length} chars, ${tail(webhookToken)}`);
  }

  console.log("\nDevice (live, read-only)");

  if (config.sender === ROTATE_SENDER) {
    warn(
      "Sender is 'rotate'",
      "no single device to report on; ensure at least one device has Rotate ON",
    );
  } else {
    const probe = await getDeviceStatus();

    if (!probe.ok) {
      fail("Could not read device status", probe.message);
      // The commonest cause by far, and invisible without saying it: the
      // Devices page lists the number WITHOUT a country code, so a sender
      // written as 91XXXXXXXXXX does not match any device.
      console.log(
        "        Check the Devices page: use the number exactly as shown there,",
      );
      console.log(
        "        which is usually 10 digits with no 91 prefix.",
      );
    } else if (probe.device.connected) {
      const device = probe.device;
      ok("Device connected", device.status);
      if (device.messagesSent !== null) {
        ok("Messages sent via this device", String(device.messagesSent));
      }
      if (device.webhookUrl) {
        ok("Webhook registered", device.webhookUrl);
        if (!device.webhookUrl.includes("token=")) {
          fail(
            "Registered webhook URL carries no token",
            "every callback will be rejected — append ?token=<WHATSAPP_WEBHOOK_TOKEN>",
          );
        } else if (webhookToken !== "" && !device.webhookUrl.includes(webhookToken)) {
          fail(
            "Registered webhook token does not match WHATSAPP_WEBHOOK_TOKEN",
            "callbacks will be rejected with 403",
          );
        } else {
          ok("Webhook token matches the environment");
        }
      } else {
        warn(
          "No webhook registered for this device",
          "paste https://<your-app>/api/whatsapp/webhook?token=<token> on the Devices page",
        );
      }
    } else {
      fail(
        "Device is not connected",
        `${probe.device.status} — scan its QR code in the provider panel`,
      );
    }
  }

  const target = process.argv[2]?.trim();
  if (target) {
    console.log("\nNumber check (live, read-only)");
    const result = await checkNumber(target.replace(/\D/g, ""));
    if (!result.checked) {
      fail("Could not check that number", result.message);
    } else if (result.exists) {
      ok(`${target} is on WhatsApp`);
    } else {
      warn(`${target} is NOT on WhatsApp`, "sends to it will be refused before dispatch");
    }
  }
}

main()
  .catch((error: unknown) => {
    problems += 1;
    console.error("\nScript error:", error);
  })
  .finally(() => {
    console.log(
      problems === 0
        ? "\nWhatsApp integration looks healthy."
        : `\n${problems} problem(s) found.`,
    );
    process.exitCode = problems === 0 ? 0 : 1;
  });
