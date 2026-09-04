/**
 * A local device occupies a purchased provider slot until Remove succeeds and
 * deletes that row. Enabled/disabled and connection state do not free slots.
 */
export const whatsappConfiguredDeviceCount = {
  _count: { select: { devices: true } },
} as const;

export function configuredWhatsappDeviceCount(account: {
  _count: { devices: number };
}): number {
  return account._count.devices;
}

export function whatsappProviderHasCapacity(account: {
  deviceLimit: number;
  _count: { devices: number };
}): boolean {
  return configuredWhatsappDeviceCount(account) < account.deviceLimit;
}
