export const PLIVO_PUBLIC_WEBHOOK_ORIGIN_ENV =
  "PLIVO_PUBLIC_WEBHOOK_ORIGIN" as const;

export class PlivoPublicWebhookConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlivoPublicWebhookConfigurationError";
  }
}

function parseRequestUrl(requestUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch {
    throw new PlivoPublicWebhookConfigurationError(
      "The Plivo webhook request URL is invalid.",
    );
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new PlivoPublicWebhookConfigurationError(
      "Plivo webhook request URLs must use HTTP or HTTPS.",
    );
  }
  return parsed;
}

function parseConfiguredOrigin(value: string, production: boolean): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new PlivoPublicWebhookConfigurationError(
      `${PLIVO_PUBLIC_WEBHOOK_ORIGIN_ENV} must be a valid URL origin.`,
    );
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new PlivoPublicWebhookConfigurationError(
      `${PLIVO_PUBLIC_WEBHOOK_ORIGIN_ENV} must use HTTP or HTTPS.`,
    );
  }
  if (production && parsed.protocol !== 'https:') {
    throw new PlivoPublicWebhookConfigurationError(
      `${PLIVO_PUBLIC_WEBHOOK_ORIGIN_ENV} must use HTTPS in production.`,
    );
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new PlivoPublicWebhookConfigurationError(
      `${PLIVO_PUBLIC_WEBHOOK_ORIGIN_ENV} must not include credentials.`,
    );
  }
  if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
    throw new PlivoPublicWebhookConfigurationError(
      `${PLIVO_PUBLIC_WEBHOOK_ORIGIN_ENV} must contain an origin only.`,
    );
  }

  return parsed.origin;
}

/**
 * Reconstructs the exact public URL Plivo signs without trusting Host or
 * X-Forwarded-* headers supplied by the caller. The actual request pathname and
 * query string remain authoritative; only the reverse-proxy origin is replaced.
 */
export function resolvePlivoPublicWebhookUrl(
  requestUrl: string,
  options: {
    publicOrigin?: string | null;
    nodeEnv?: string;
  } = {},
): string {
  const requested = parseRequestUrl(requestUrl);
  const production = (options.nodeEnv ?? process.env.NODE_ENV) === 'production';
  const configured =
    options.publicOrigin === undefined
      ? process.env.PLIVO_PUBLIC_WEBHOOK_ORIGIN
      : options.publicOrigin;
  const configuredValue = configured?.trim() ?? '';

  if (configuredValue === '') {
    if (production) {
      throw new PlivoPublicWebhookConfigurationError(
        `${PLIVO_PUBLIC_WEBHOOK_ORIGIN_ENV} is required in production.`,
      );
    }
    return requested.toString();
  }

  const publicOrigin = parseConfiguredOrigin(configuredValue, production);
  return new URL(`${requested.pathname}${requested.search}`, publicOrigin).toString();
}
