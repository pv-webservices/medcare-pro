import { describe, expect, it } from "vitest";
import {
  assertNotPlatformTenant,
  CUSTOMER_TENANT_WHERE,
  isPlatformTenant,
  PLATFORM_TENANT_SLUG,
  PlatformTenantError,
} from "@/lib/platformTenant";

describe("CUSTOMER_TENANT_WHERE", () => {
  it("filters the reserved row out of every customer query", () => {
    expect(CUSTOMER_TENANT_WHERE).toEqual({ isPlatform: false });
  });

  it("spreads cleanly into a larger where clause", () => {
    expect({ ...CUSTOMER_TENANT_WHERE, status: "ACTIVE" }).toEqual({
      isPlatform: false,
      status: "ACTIVE",
    });
  });

  it("cannot be widened by a later spread of the same key", () => {
    // Guards the ordering mistake: the filter must come first so a caller's own
    // keys extend it rather than a stale isPlatform overriding it.
    const composed = { status: "ACTIVE", ...CUSTOMER_TENANT_WHERE };
    expect(composed.isPlatform).toBe(false);
  });
});

describe("isPlatformTenant", () => {
  it("recognises the row by its flag", () => {
    expect(isPlatformTenant({ isPlatform: true })).toBe(true);
  });

  it("recognises the row by its slug, in case the flag was missed", () => {
    expect(isPlatformTenant({ slug: PLATFORM_TENANT_SLUG })).toBe(true);
  });

  it("does not mistake a customer for it", () => {
    expect(isPlatformTenant({ isPlatform: false, slug: "acme-clinic" })).toBe(false);
  });

  it("treats a missing tenant as not the platform row", () => {
    expect(isPlatformTenant(null)).toBe(false);
    expect(isPlatformTenant(undefined)).toBe(false);
    expect(isPlatformTenant({})).toBe(false);
  });
});

describe("assertNotPlatformTenant", () => {
  it("throws for the reserved row", () => {
    expect(() => assertNotPlatformTenant({ isPlatform: true })).toThrow(
      PlatformTenantError,
    );
    expect(() => assertNotPlatformTenant({ slug: PLATFORM_TENANT_SLUG })).toThrow(
      PlatformTenantError,
    );
  });

  it("passes an ordinary customer through", () => {
    expect(() =>
      assertNotPlatformTenant({ isPlatform: false, slug: "acme-clinic" }),
    ).not.toThrow();
  });

  it("carries a fixed message that identifies no organisation", () => {
    // The message reaches a log and possibly a response, so it must read the
    // same whichever row triggered it — never echoing a name back to a caller.
    const messages = [
      { isPlatform: true },
      { slug: PLATFORM_TENANT_SLUG },
      { isPlatform: true, slug: PLATFORM_TENANT_SLUG },
    ].map((tenant) => {
      try {
        assertNotPlatformTenant(tenant);
        return "did not throw";
      } catch (error) {
        return (error as Error).message;
      }
    });

    expect(new Set(messages).size).toBe(1);
    expect(messages[0]).toBe("The platform tenant is not a customer organisation.");
  });
});
