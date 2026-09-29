import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { describeScriptError } from "@/lib/scriptErrors";

const URL_WITH_SECRETS = "mysql://clinic_admin:S3cret-pass@db.internal.example:3306/medcare_prod";

describe("describeScriptError", () => {
  it("keeps the Prisma code and the reason, not the invocation code frame", () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      "\nInvalid `prisma.feature.create()` invocation in\n/app/scripts/backfill-billing.mts:40:3\n\n  39 const x = 1;\n→ 40 await prisma.feature.create(\nUnique constraint failed on the constraint: `features_key_key`",
      { code: "P2002", clientVersion: "6.19.3" },
    );
    const line = describeScriptError(error, URL_WITH_SECRETS);
    expect(line).toBe("name=PrismaClientKnownRequestError code=P2002 message=Unique constraint failed on the constraint: `features_key_key`");
    expect(line).not.toContain("backfill-billing.mts");
  });

  it("redacts the database URL, user, password and host", () => {
    const error = new Prisma.PrismaClientInitializationError(
      "Authentication failed against database server at `db.internal.example`, the provided database credentials for `clinic_admin` are not valid. Tried S3cret-pass via " + URL_WITH_SECRETS,
      "6.19.3", "P1000",
    );
    const line = describeScriptError(error, URL_WITH_SECRETS);
    expect(line).toContain("name=PrismaClientInitializationError code=P1000");
    for (const secret of ["clinic_admin", "S3cret-pass", "db.internal.example", "mysql://"]) expect(line).not.toContain(secret);
  });

  it("keeps the leading reason of a multi-paragraph connection error, redacted", () => {
    const error = new Prisma.PrismaClientInitializationError(
      "Authentication failed against database server, the provided database credentials for `clinic_admin` are not valid.\n\nPlease make sure to provide valid database credentials for the database server at the configured address.",
      "6.19.3",
    );
    expect(describeScriptError(error, URL_WITH_SECRETS)).toBe("name=PrismaClientInitializationError message=Authentication failed against database server, the provided database credentials for `<redacted>` are not valid.");
  });

  it("omits a validation error's message, which can echo query arguments", () => {
    const error = new Prisma.PrismaClientValidationError("Argument `name`: Invalid value provided. Patient Asha Verma, 9876543210", { clientVersion: "6.19.3" });
    const line = describeScriptError(error, URL_WITH_SECRETS);
    expect(line).toBe("name=PrismaClientValidationError message=(omitted: a validation error echoes query arguments)");
  });

  // "" = no DATABASE_URL: an explicit undefined would fall back to the real environment variable.
  it("describes plain and driver errors, and non-Error throws", () => {
    const driver = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:3306"), { code: "ECONNREFUSED" });
    expect(describeScriptError(driver, "")).toBe("name=Error code=ECONNREFUSED message=connect ECONNREFUSED 127.0.0.1:3306");
    expect(describeScriptError("boom", "")).toBe("name=string");
    expect(describeScriptError(new Error("x".repeat(400)), "")).toHaveLength("name=Error message=".length + 301);
  });
});
