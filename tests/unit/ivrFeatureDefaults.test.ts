import { describe, expect, it } from "vitest";
import {
  DEFAULT_FEATURES,
  DEFAULT_PLAN_KEY,
} from "@/lib/defaultFeatures";
import {
  MODULE_FEATURES,
  UNGATED_MODULES,
} from "@/lib/moduleFeatures";
import { resolveModuleAccess, resolveTenantFeatureAccess } from "@/lib/featureResolution";

const IVR = "ivr";

const ivrFeature = DEFAULT_FEATURES.find(
  (feature) => feature.key === IVR,
);

describe("the IVR catalogue entry", () => {
  it("exists exactly once", () => {
    expect(
      DEFAULT_FEATURES.filter((feature) => feature.key === IVR),
    ).toHaveLength(1);
  });

  it("ships CORE, so silence at layer 3 allows existing customer access", () => {
    expect(ivrFeature?.tier).toBe("CORE");
  });

  it("is on at the platform switch initially", () => {
    expect(ivrFeature?.globalEnabled).toBe(true);
  });

  it("is included in the default plan", () => {
    expect(ivrFeature?.inDefaultPlan).toBe(true);
    expect(DEFAULT_PLAN_KEY).toBe("standard");
  });

  it("carries a name and clear description", () => {
    expect(ivrFeature?.name).toBe("IVR");
    expect(ivrFeature?.description).toBeTruthy();
  });
});

describe("IVR in the module map", () => {
  it("gates the ivr module", () => {
    expect(MODULE_FEATURES.ivr).toBe(IVR);
  });

  it("is not listed as ungated (is enforced)", () => {
    expect(UNGATED_MODULES[IVR]).toBeUndefined();
  });
});

describe("what the Superadmin global switch does to IVR resolution", () => {
  const entitled = {
    globalEnabled: true,
    planEnabled: true,
    tenantOverride: null,
    tier: "CORE",
  } as const;

  it("allows an entitled tenant by default when the global switch is ON", () => {
    const verdict = resolveModuleAccess({
      ...entitled,
      roleAccess: null,
      roleHoldsWildcard: false,
    });
    expect(verdict.allowed).toBe(true);
  });

  it("immediately denies everyone when the Superadmin switches IVR OFF", () => {
    const verdict = resolveModuleAccess({
      ...entitled,
      globalEnabled: false,
      roleAccess: true,
      roleHoldsWildcard: true,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe("global");
  });

  it("denies non-human tenant feature resolution when global switch is OFF", () => {
    const verdict = resolveTenantFeatureAccess({
      globalEnabled: false,
      planEnabled: true,
      tenantOverride: true,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe("global");
  });

  it("restores access when the Superadmin switches IVR back ON", () => {
    const verdict = resolveModuleAccess({
      ...entitled,
      globalEnabled: true,
      roleAccess: null,
      roleHoldsWildcard: false,
    });
    expect(verdict.allowed).toBe(true);
  });

  it("still respects Layer 2 plan restrictions when global switch is ON", () => {
    const verdict = resolveModuleAccess({
      ...entitled,
      planEnabled: false,
      roleAccess: true,
      roleHoldsWildcard: true,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe("entitlement");
  });

  it("still respects Layer 2 tenant overrides when global switch is ON", () => {
    const verdict = resolveModuleAccess({
      ...entitled,
      tenantOverride: false,
      roleAccess: true,
      roleHoldsWildcard: true,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe("entitlement");
  });

  it("is completely independent from WhatsApp messaging feature", () => {
    // IVR and WhatsApp must be separate keys
    expect(MODULE_FEATURES.ivr).not.toBe(MODULE_FEATURES.whatsapp);

    // IVR ON, WhatsApp OFF
    const ivrOnVerdict = resolveModuleAccess({
      globalEnabled: true,
      planEnabled: true,
      tenantOverride: null,
      tier: "CORE",
      roleAccess: null,
      roleHoldsWildcard: false,
    });
    const whatsappOffVerdict = resolveModuleAccess({
      globalEnabled: false,
      planEnabled: true,
      tenantOverride: null,
      tier: "CORE",
      roleAccess: null,
      roleHoldsWildcard: false,
    });
    expect(ivrOnVerdict.allowed).toBe(true);
    expect(whatsappOffVerdict.allowed).toBe(false);
    expect(whatsappOffVerdict.reason).toBe("global");
  });
});
