import type { WhatsappDeviceConnectionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getDeviceStatus, type WhatsappConfig } from "@/lib/whatsapp";
import { decryptWhatsappApiKey } from "@/lib/whatsappCredentialCrypto";

export interface WhatsappProviderCredentialRow {
  id: string;
  tenantId: string;
  apiBaseUrl: string;
  encryptedApiKey: string;
}

export function whatsappConfigForProviderDevice(
  account: WhatsappProviderCredentialRow,
  phoneNumber: string,
): WhatsappConfig {
  return {
    sender: phoneNumber,
    baseUrl: account.apiBaseUrl.replace(/\/+$/, ""),
    apiKey: decryptWhatsappApiKey(
      account.encryptedApiKey,
      account.tenantId,
      account.id,
    ),
  };
}

export type WhatsappProviderDeviceState =
  | {
      outcome: "PRESENT";
      connectionStatus: "CONNECTED" | "DISCONNECTED" | "PENDING" | "UNKNOWN";
      message: string;
    }
  | {
      outcome: "NOT_FOUND";
      connectionStatus: "MISSING";
      message: string;
    }
  | {
      outcome: "UNKNOWN";
      connectionStatus: "UNKNOWN";
      message: string;
    };

const inFlightDeviceSyncs = new Map<
  string,
  Promise<WhatsappProviderDeviceState & { checkedAt: Date }>
>();

export async function probeWhatsappDeviceForProvider(
  account: WhatsappProviderCredentialRow,
  phoneNumber: string,
): Promise<WhatsappProviderDeviceState> {
  const probe = await getDeviceStatus(
    whatsappConfigForProviderDevice(account, phoneNumber),
  );
  if (probe.ok) {
    const providerStatus = probe.device.status.trim().toLowerCase();
    const connectionStatus = probe.device.connected
      ? "CONNECTED"
      : /^(offline|disconnect|disconnected|logout|logged out)$/.test(providerStatus)
        ? "DISCONNECTED"
        : /^(connecting|pending|qr|waiting|waiting for qr|scan qr)$/.test(providerStatus)
          ? "PENDING"
          : "UNKNOWN";
    return {
      outcome: "PRESENT",
      connectionStatus,
      message: probe.device.status,
    };
  }
  if (probe.reason === "NOT_FOUND") {
    return {
      outcome: "NOT_FOUND",
      connectionStatus: "MISSING",
      message: probe.message,
    };
  }
  return {
    outcome: "UNKNOWN",
    connectionStatus: "UNKNOWN",
    message: probe.message,
  };
}

/** Reconciles one known local device; the tenant predicate is defense in depth. */
export async function syncWhatsappDeviceWithProvider(device: {
  id: string;
  tenantId: string;
  phoneNumber: string;
  providerAccount: WhatsappProviderCredentialRow;
}): Promise<WhatsappProviderDeviceState & { checkedAt: Date }> {
  if (device.providerAccount.tenantId !== device.tenantId) {
    throw new Error("WhatsApp provider account tenant mismatch.");
  }
  const key = `${device.tenantId}:${device.id}`;
  const existing = inFlightDeviceSyncs.get(key);
  if (existing) return existing;
  const sync = (async () => {
    const checkedAt = new Date();
    const state = await probeWhatsappDeviceForProvider(
      device.providerAccount,
      device.phoneNumber,
    );
    await prisma.whatsappDevice.updateMany({
      where: { id: device.id, tenantId: device.tenantId },
      data: {
        connectionStatus: state.connectionStatus as WhatsappDeviceConnectionStatus,
        lastStatusCheckedAt: checkedAt,
      },
    });
    return { ...state, checkedAt };
  })();
  inFlightDeviceSyncs.set(key, sync);
  try {
    return await sync;
  } finally {
    inFlightDeviceSyncs.delete(key);
  }
}
