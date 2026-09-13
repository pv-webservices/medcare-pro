export const PRODUCTION_DB_NAME = "u292106402_medcare";

export interface PortalBackfillGuardOptions {
  apply?: boolean;
  allowRemote?: boolean;
  allowProduction?: boolean;
  confirmProductionDb?: string;
}

export function parseDatabaseName(url: string): string {
  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  } catch {
    return "";
  }
}

export function assertPortalBackfillTarget(
  url: string,
  applyOrOptions?: boolean | PortalBackfillGuardOptions,
  allowRemoteArg?: boolean,
  allowProductionArg?: boolean,
  confirmProductionDbArg?: string,
) {
  const options: PortalBackfillGuardOptions =
    typeof applyOrOptions === "object" && applyOrOptions !== null
      ? applyOrOptions
      : {
          apply: Boolean(applyOrOptions),
          allowRemote: Boolean(allowRemoteArg),
          allowProduction: Boolean(allowProductionArg),
          confirmProductionDb: confirmProductionDbArg,
        };

  const {
    apply = false,
    allowRemote = false,
    allowProduction = false,
    confirmProductionDb,
  } = options;

  let db: URL;
  try {
    db = new URL(url);
  } catch {
    throw new Error("Invalid DATABASE_URL.");
  }

  const dbName = parseDatabaseName(url);
  const isProduction = dbName === PRODUCTION_DB_NAME;
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(db.hostname);

  if (isProduction) {
    if (!allowProduction) {
      throw new Error(
        "Production execution requires explicit --allow-production flag.",
      );
    }
    if (!confirmProductionDb) {
      throw new Error(
        "Production execution requires --confirm-production-db=u292106402_medcare.",
      );
    }
    if (
      confirmProductionDb !== PRODUCTION_DB_NAME ||
      confirmProductionDb !== dbName
    ) {
      throw new Error(
        `Confirmed database '${confirmProductionDb}' does not match target database '${dbName}'.`,
      );
    }
    if (apply && !allowRemote) {
      throw new Error(
        "Production writes require explicit --apply --allow-remote.",
      );
    }
    return;
  }

  if (apply && !isLocal && !allowRemote) {
    throw new Error("Remote writes require explicit --apply --allow-remote.");
  }
}
