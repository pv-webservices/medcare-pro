-- Distinguish a provider-side missing device from a present but logged-out one.
ALTER TABLE `whatsapp_devices`
  MODIFY `connection_status` ENUM('PENDING', 'CONNECTED', 'DISCONNECTED', 'UNKNOWN', 'MISSING') NOT NULL DEFAULT 'UNKNOWN';
