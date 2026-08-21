import { describe, expect, it } from "vitest";
import {
  isReservedSlug,
  RESERVED_SLUGS,
  resolveUniqueSlug,
  slugifyBusinessName,
} from "@/lib/tenantSlug";
import { PLATFORM_TENANT_SLUG } from "@/lib/platformTenant";

describe("slugifyBusinessName", () => {
  it("lowercases and hyphenates a plain business name", () => {
    expect(slugifyBusinessName("Acme Family Clinic")).toBe("acme-family-clinic");
  });

  it("strips punctuation rather than encoding it", () => {
    expect(slugifyBusinessName("St. Mary's Health & Care, Ltd.")).toBe(
      "st-mary-s-health-care-ltd",
    );
  });

  it("keeps accented letters as their unaccented form", () => {
    // Dropping the letters entirely would turn two different clinics into the
    // same slug; transliterating keeps them distinguishable.
    expect(slugifyBusinessName("Clínica Núñez")).toBe("clinica-nunez");
  });

  it("collapses runs of separators and trims the ends", () => {
    expect(slugifyBusinessName("  ---Acme   ---  Clinic--- ")).toBe("acme-clinic");
  });

  it("falls back rather than returning an empty slug", () => {
    expect(slugifyBusinessName("!!!")).toBe("clinic");
    expect(slugifyBusinessName("")).toBe("clinic");
  });

  it("never ends in a separator, even when truncated at the limit", () => {
    const slug = slugifyBusinessName(`${"a".repeat(59)} clinic`);
    expect(slug.endsWith("-")).toBe(false);
    expect(slug.length).toBeLessThanOrEqual(60);
  });

  it("is deterministic, so a re-run of the backfill reproduces it", () => {
    const name = "Sunrise Multi-Speciality Hospital";
    expect(slugifyBusinessName(name)).toBe(slugifyBusinessName(name));
  });
});

describe("resolveUniqueSlug", () => {
  const takenBy = (...slugs: string[]) => (candidate: string) =>
    slugs.includes(candidate);

  it("returns the base unsuffixed when it is free", () => {
    expect(resolveUniqueSlug("acme", takenBy())).toBe("acme");
  });

  it("suffixes from -2 upward on collision", () => {
    expect(resolveUniqueSlug("acme", takenBy("acme"))).toBe("acme-2");
    expect(resolveUniqueSlug("acme", takenBy("acme", "acme-2"))).toBe("acme-3");
  });

  it("skips a suffixed candidate that is itself taken", () => {
    expect(resolveUniqueSlug("acme", takenBy("acme", "acme-2", "acme-3"))).toBe(
      "acme-4",
    );
  });

  it("never hands out a reserved slug", () => {
    // The load-bearing case: a business genuinely called "Platform" must not be
    // able to claim the row the Platform Owner's login points at.
    expect(resolveUniqueSlug(PLATFORM_TENANT_SLUG, takenBy())).toBe("platform-2");
    expect(resolveUniqueSlug("settings", takenBy())).toBe("settings-2");
  });

  it("throws instead of looping forever when nothing is free", () => {
    expect(() => resolveUniqueSlug("acme", () => true, 5)).toThrow(
      /Could not find a free slug/,
    );
  });

  it("falls back when handed an empty base", () => {
    expect(resolveUniqueSlug("", takenBy())).toBe("clinic");
  });
});

describe("RESERVED_SLUGS", () => {
  it("includes the platform slug", () => {
    expect(RESERVED_SLUGS).toContain(PLATFORM_TENANT_SLUG);
    expect(isReservedSlug(PLATFORM_TENANT_SLUG)).toBe(true);
  });

  it("contains no duplicates", () => {
    expect(new Set(RESERVED_SLUGS).size).toBe(RESERVED_SLUGS.length);
  });

  it("is made only of well-formed slugs, so it can never miss a match", () => {
    for (const slug of RESERVED_SLUGS) {
      expect(slugifyBusinessName(slug)).toBe(slug);
    }
  });

  it("does not treat an ordinary name as reserved", () => {
    expect(isReservedSlug("acme-family-clinic")).toBe(false);
  });
});
