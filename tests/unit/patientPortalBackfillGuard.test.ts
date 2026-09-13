import { describe, expect, it } from "vitest";
import {
  assertPortalBackfillTarget,
  parseDatabaseName,
  PRODUCTION_DB_NAME,
} from "@/lib/patientPortalBackfillGuard";

describe("Patient Portal password auth backfill release guard", () => {
  const prodUrl = "mysql://u292106402_medcare:secret@127.0.0.1:3306/" + PRODUCTION_DB_NAME;
  const remoteStagingUrl =
    "mysql://staging_user:secret@staging.medcare.sitecraf.com:3306/medcare_staging";
  const localUrl = "mysql://root:localpass@127.0.0.1:33321/medcare_ep_portal_test";

  it("extracts database name correctly from URL", () => {
    expect(parseDatabaseName(prodUrl)).toBe(PRODUCTION_DB_NAME);
    expect(parseDatabaseName(remoteStagingUrl)).toBe("medcare_staging");
    expect(parseDatabaseName(localUrl)).toBe("medcare_ep_portal_test");
  });

  // 1. production URL + no flags → FAIL
  it("fails when targeting production URL with no flags", () => {
    expect(() => assertPortalBackfillTarget(prodUrl, {})).toThrow(
      /Production execution requires explicit --allow-production flag/i,
    );
  });

  // 2. production URL + --apply → FAIL
  it("fails when targeting production URL with --apply alone", () => {
    expect(() =>
      assertPortalBackfillTarget(prodUrl, { apply: true }),
    ).toThrow(/Production execution requires explicit --allow-production flag/i);
  });

  // 3. production URL + --apply --allow-remote → FAIL
  it("fails when targeting production URL with --apply --allow-remote", () => {
    expect(() =>
      assertPortalBackfillTarget(prodUrl, {
        apply: true,
        allowRemote: true,
      }),
    ).toThrow(/Production execution requires explicit --allow-production flag/i);
  });

  // 4. production URL + --allow-production but wrong confirmed DB → FAIL
  it("fails when targeting production URL with wrong confirmed DB", () => {
    expect(() =>
      assertPortalBackfillTarget(prodUrl, {
        apply: true,
        allowRemote: true,
        allowProduction: true,
        confirmProductionDb: "wrong_database_name",
      }),
    ).toThrow(/does not match target database/i);

    expect(() =>
      assertPortalBackfillTarget(prodUrl, {
        apply: true,
        allowRemote: true,
        allowProduction: true,
        confirmProductionDb: undefined,
      }),
    ).toThrow(/requires --confirm-production-db=u292106402_medcare/i);
  });

  // 5. production URL + exact required production confirmation → allowed
  it("allows production apply with exact required production confirmation flags", () => {
    expect(() =>
      assertPortalBackfillTarget(prodUrl, {
        apply: true,
        allowRemote: true,
        allowProduction: true,
        confirmProductionDb: PRODUCTION_DB_NAME,
      }),
    ).not.toThrow();
  });

  it("allows production dry-run with production confirmation flags", () => {
    expect(() =>
      assertPortalBackfillTarget(prodUrl, {
        apply: false,
        allowProduction: true,
        confirmProductionDb: PRODUCTION_DB_NAME,
      }),
    ).not.toThrow();
  });

  // 6. remote staging + no allow-remote → FAIL on apply
  it("fails when applying on remote staging without --allow-remote", () => {
    expect(() =>
      assertPortalBackfillTarget(remoteStagingUrl, { apply: true }),
    ).toThrow(/Remote writes require explicit --apply --allow-remote/i);
  });

  // 7. remote staging + --apply --allow-remote → allowed
  it("allows apply on remote staging when --apply --allow-remote are provided", () => {
    expect(() =>
      assertPortalBackfillTarget(remoteStagingUrl, {
        apply: true,
        allowRemote: true,
      }),
    ).not.toThrow();
  });

  // 8. local DB + --apply → allowed
  it("allows apply on local DB with --apply", () => {
    expect(() =>
      assertPortalBackfillTarget(localUrl, { apply: true }),
    ).not.toThrow();
  });

  // 9. dry run: → allowed without production-write permission
  it("allows dry-run on local and remote staging without write permissions", () => {
    expect(() =>
      assertPortalBackfillTarget(localUrl, { apply: false }),
    ).not.toThrow();
    expect(() =>
      assertPortalBackfillTarget(remoteStagingUrl, { apply: false }),
    ).not.toThrow();
  });
});
