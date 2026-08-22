import { describe, expect, it } from "vitest";
import {
  DEFAULT_FEATURES,
  DEFAULT_PLAN_KEY,
} from "@/lib/defaultFeatures";
import {
  MODULE_FEATURES,
  UNGATED_MODULES,
} from "@/lib/moduleFeatures";
import { resolveModuleAccess } from "@/lib/featureResolution";

const APPOINTMENTS = "appointments";

const appointmentsFeature = DEFAULT_FEATURES.find(
  (feature) => feature.key === APPOINTMENTS,
);

describe("the appointments catalogue entry", () => {
  it("exists exactly once", () => {
    expect(
      DEFAULT_FEATURES.filter((feature) => feature.key === APPOINTMENTS),
    ).toHaveLength(1);
  });

  it("ships PREMIUM, so silence at layer 3 denies", () => {
    // Every other module here is CORE because clinics already depend on them.
    // Nobody depends on appointments, so there is nothing to break, and PREMIUM
    // is what lets a Clinic Admin decide who gets it rather than it appearing
    // for every role at once.
    expect(appointmentsFeature?.tier).toBe("PREMIUM");
  });

  it("is on at the platform switch", () => {
    // Layer 1 is the Owner's kill switch; a feature shipped off would be
    // unreachable no matter what a plan or an override said.
    expect(appointmentsFeature?.globalEnabled).toBe(true);
  });

  it("is included in the default plan", () => {
    expect(appointmentsFeature?.inDefaultPlan).toBe(true);
    expect(DEFAULT_PLAN_KEY).toBe("standard");
  });

  it("carries a description that says what the module does", () => {
    expect(appointmentsFeature?.description).toBeTruthy();
    expect(appointmentsFeature?.name).toBe("Appointments");
  });
});

describe("appointments in the module map", () => {
  it("gates the appointments module", () => {
    expect(MODULE_FEATURES.appointments).toBe(APPOINTMENTS);
  });

  it("is not listed as ungated", () => {
    // Being in both, or in neither, is the failure mode the catalogue test in
    // moduleFeatures.test.ts exists to catch. Stated here too because this is
    // the file someone reads when they add the AP-6 screen.
    expect(UNGATED_MODULES[APPOINTMENTS]).toBeUndefined();
  });
});

describe("what PREMIUM actually does at the resolver", () => {
  // The real resolver, not a restatement of its rules. If the tier semantics
  // ever change, these fail rather than passing on a stale assumption.
  const entitled = {
    globalEnabled: true,
    planEnabled: true,
    tenantOverride: null,
    tier: "PREMIUM",
  } as const;

  it("denies an entitled organisation until a role is switched on", () => {
    const verdict = resolveModuleAccess({
      ...entitled,
      roleAccess: null,
      roleHoldsWildcard: false,
    });
    expect(verdict.allowed).toBe(false);
  });

  it("blames the role, not the entitlement, when it denies", () => {
    // The refusal has to name the right person. "Your organisation does not
    // have this" would send an admin to sales; "your role does not have this"
    // sends them to the Features screen, which is where the fix is.
    const verdict = resolveModuleAccess({
      ...entitled,
      roleAccess: null,
      roleHoldsWildcard: false,
    });
    expect(verdict.reason).toBe("role");
  });

  it("allows once a Clinic Admin writes the row", () => {
    expect(
      resolveModuleAccess({
        ...entitled,
        roleAccess: true,
        roleHoldsWildcard: false,
      }).allowed,
    ).toBe(true);
  });

  it("allows the account owner without a row", () => {
    // Layer 3 cannot take a module away from the wildcard holder.
    expect(
      resolveModuleAccess({
        ...entitled,
        roleAccess: null,
        roleHoldsWildcard: true,
      }).allowed,
    ).toBe(true);
  });

  it("still obeys the platform kill switch, even for the owner", () => {
    expect(
      resolveModuleAccess({
        ...entitled,
        globalEnabled: false,
        roleAccess: true,
        roleHoldsWildcard: true,
      }).reason,
    ).toBe("global");
  });

  it("still obeys the plan, even for the owner", () => {
    expect(
      resolveModuleAccess({
        ...entitled,
        planEnabled: false,
        roleAccess: true,
        roleHoldsWildcard: true,
      }).reason,
    ).toBe("entitlement");
  });

  it("would have behaved differently as CORE, which is the whole point", () => {
    // The contrast, spelled out: the same silent layer 3 that denies above
    // would allow if this module had shipped CORE.
    const asCore = resolveModuleAccess({
      ...entitled,
      tier: "CORE",
      roleAccess: null,
      roleHoldsWildcard: false,
    });
    expect(asCore.allowed).toBe(true);
  });
});
