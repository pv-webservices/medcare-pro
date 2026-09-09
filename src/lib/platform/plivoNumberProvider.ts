import { Client } from "plivo";
import { normalizePlivoDestinationNumber } from "@/lib/telephony/phoneNumber";

const PAGE_SIZE = 20;

interface ProviderList<T> extends Array<T> {
  meta?: { total_count?: number; totalCount?: number };
}

interface RawNumber {
  number?: unknown;
  application?: unknown;
  applicationId?: unknown;
  appId?: unknown;
  number_type?: unknown;
  numberType?: unknown;
  region?: unknown;
}

interface RawApplication {
  app_id?: unknown;
  appId?: unknown;
  app_name?: unknown;
  appName?: unknown;
}

export interface ProviderPlivoNumber {
  readonly phoneNumber: string;
  readonly applicationId: string | null;
  readonly applicationName: string | null;
  readonly numberType: string | null;
  readonly region: string | null;
}

export interface PlatformPlivoNumberProvider {
  listOwnedNumbers(): Promise<readonly ProviderPlivoNumber[]>;
}

function optionalText(value: unknown, maximum: number): string | null {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim().slice(0, maximum)
    : null;
}

export function extractPlivoApplicationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const direct = value.trim();
  if (/^\d{5,64}$/.test(direct)) return direct;
  return direct.match(/\/Application\/(\d{5,64})\/?(?:\?.*)?$/)?.[1] ?? null;
}

async function listEveryPage<T>(
  fetchPage: (input: { limit: number; offset: number }) => Promise<ProviderList<T>>,
): Promise<T[]> {
  const all: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await fetchPage({ limit: PAGE_SIZE, offset });
    all.push(...page);
    const total = page.meta?.total_count ?? page.meta?.totalCount;
    if (page.length === 0 || (typeof total === "number" && all.length >= total)) {
      return all;
    }
    if (page.length < PAGE_SIZE && typeof total !== "number") return all;
  }
}

/** Read-only adapter over the deployment-level shared Plivo account. */
export function createPlatformPlivoNumberProvider(input: {
  authId: string;
  authToken: string;
}): PlatformPlivoNumberProvider {
  const client = new Client(input.authId, input.authToken);
  return Object.freeze({
    async listOwnedNumbers() {
      const [numbers, applications] = await Promise.all([
        listEveryPage<RawNumber>((page) => client.numbers.list(page)),
        listEveryPage<RawApplication>(async (page) =>
          client.applications.list(page) as unknown as ProviderList<RawApplication>,
        ),
      ]);
      const applicationNames = new Map<string, string>();
      for (const application of applications) {
        const id = extractPlivoApplicationId(
          application.app_id ?? application.appId,
        );
        const name = optionalText(application.app_name ?? application.appName, 100);
        if (id && name) applicationNames.set(id, name);
      }

      const seen = new Set<string>();
      return numbers.map((number) => {
        if (typeof number.number !== "string") {
          throw new Error("Plivo returned a number without a valid identifier.");
        }
        const phoneNumber = normalizePlivoDestinationNumber(number.number);
        if (seen.has(phoneNumber)) {
          throw new Error("Plivo returned the same number more than once.");
        }
        seen.add(phoneNumber);
        const applicationId = extractPlivoApplicationId(
          number.applicationId ?? number.appId ?? number.application,
        );
        return Object.freeze({
          phoneNumber,
          applicationId,
          applicationName: applicationId
            ? applicationNames.get(applicationId) ?? null
            : null,
          numberType: optionalText(number.number_type ?? number.numberType, 32),
          region: optionalText(number.region, 100),
        });
      });
    },
  });
}
