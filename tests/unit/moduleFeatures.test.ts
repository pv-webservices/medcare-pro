import { describe, expect, it } from "vitest";
import { DEFAULT_FEATURES } from "@/lib/defaultFeatures";
import {
  FEATURE_DENIAL_MESSAGES,
  FeatureError,
  describeFeatureDenial,
} from "@/lib/featureResolution";
import {
  CATALOGUE_FEATURE_KEYS,
  MODULE_FEATURES,
  UNGATED_MODULES,
} from "@/lib/moduleFeatures";
import { NAV_LINKS } from "@/lib/navigation";

/**
 * The wiring between the feature catalogue, the module map and the navigation.
 *
 * None of this needs a database, and all of it is the kind of thing that breaks
 * silently: a mistyped key does not throw, it just stops gating the module it
 * was supposed to gate.
 */

const CATALOGUE = new Set(CATALOGUE_FEATURE_KEYS);

describe("MODULE_FEATURES", () => {
  it("names only features the catalogue actually defines", () => {
    // A key here that DEFAULT_FEATURES does not carry would resolve to the
    // missing-feature path and deny the whole module in production, while
    // looking perfectly correct in review.
    for (const key of Object.values(MODULE_FEATURES)) {
      expect(CATALOGUE.has(key)).toBe(true);
    }
  });

  it("maps each module to itself, so a reader never has to translate", () => {
    for (const [module, feature] of Object.entries(MODULE_FEATURES)) {
      expect(feature).toBe(module);
    }
  });

  it("gates no key that is listed as ungated", () => {
    // The two lists are opposites. A key in both would mean the settings
    // lockout guard was quietly cancelled by an entry above it.
    for (const key of Object.values(MODULE_FEATURES)) {
      expect(key in UNGATED_MODULES).toBe(false);
    }
  });

  it("accounts for every feature in the catalogue, gated or explicitly not", () => {
    // Forces a decision when a feature is added: either it gates a module or it
    // says here why it does not. A key falling through both lists would be a
    // module nobody remembered to protect.
    for (const key of CATALOGUE_FEATURE_KEYS) {
      const isGated = Object.values(MODULE_FEATURES).includes(
        key as (typeof MODULE_FEATURES)[keyof typeof MODULE_FEATURES],
      );
      expect(isGated || key in UNGATED_MODULES).toBe(true);
    }
  });
});

describe("UNGATED_MODULES", () => {
  it("keeps the settings module ungated, which is the lockout guard", () => {
    // If a feature switch could close the Features screen, an organisation
    // could switch away the only control that would open it again, and the
    // remedy would be SQL against a live database.
    expect("settings" in UNGATED_MODULES).toBe(true);
  });

  it("gives a reason for every entry", () => {
    for (const [key, note] of Object.entries(UNGATED_MODULES)) {
      expect(CATALOGUE.has(key)).toBe(true);
      expect(note.length).toBeGreaterThan(0);
    }
  });
});

describe("the navigation's feature keys", () => {
  it("names only features the catalogue defines", () => {
    for (const link of NAV_LINKS) {
      if (link.feature !== null) {
        expect(CATALOGUE.has(link.feature)).toBe(true);
      }
    }
  });

  it("leaves both settings tabs ungated", () => {
    // Same guard, seen from the navigation: hiding the tab would be as
    // effective a lockout as refusing the page.
    for (const href of ["/settings/roles", "/settings/features"]) {
      expect(NAV_LINKS.find((link) => link.href === href)?.feature).toBeNull();
    }
  });

  it("leaves the dashboard reachable whatever the plan says", () => {
    const dashboard = NAV_LINKS.find((link) => link.href === "/dashboard");
    expect(dashboard?.feature).toBeNull();
    expect(dashboard?.permission).toBeNull();
  });

  it("gates every other tab", () => {
    const ungated = NAV_LINKS.filter((link) => link.feature === null).map(
      (link) => link.href,
    );
    expect(ungated.sort()).toEqual([
      "/dashboard",
      "/settings/features",
      "/settings/roles",
    ]);
  });
});

describe("the catalogue's own shape", () => {
  it("has one entry per key, with no duplicates", () => {
    expect(CATALOGUE.size).toBe(CATALOGUE_FEATURE_KEYS.length);
  });

  it("ships every module a tenant uses daily as CORE", () => {
    // The tier decides what an absent layer-3 row means. Anything a working
    // clinic already relies on must be CORE, or enforcement day locks every
    // existing role out of it.
    for (const key of Object.values(MODULE_FEATURES)) {
      const feature = DEFAULT_FEATURES.find((entry) => entry.key === key);
      expect(feature?.tier).toBe("CORE");
    }
  });

  it("ships the one unbuilt module switched off at the platform layer", () => {
    const marketing = DEFAULT_FEATURES.find((entry) => entry.key === "marketing");
    expect(marketing?.globalEnabled).toBe(false);
    expect(marketing?.inDefaultPlan).toBe(false);
  });
});

describe("what a refusal tells the reader", () => {
  it("sends each layer's refusal to a different person", () => {
    // The whole reason the messages differ: a receptionist should not file a
    // ticket about something their own admin fixes in ten seconds, and should
    // not badger their admin about a plan the admin cannot change.
    expect(describeFeatureDenial("role")).toContain("admin in your organisation");
    expect(describeFeatureDenial("entitlement")).toContain("Contact MEDCARE PRO");
    expect(describeFeatureDenial("global")).toContain("Nothing on your side");
  });

  it("keeps the three messages distinct", () => {
    const messages = Object.values(FEATURE_DENIAL_MESSAGES);
    expect(new Set(messages).size).toBe(messages.length);
  });

  it("names no plan, no feature key and no other organisation", () => {
    for (const message of Object.values(FEATURE_DENIAL_MESSAGES)) {
      const lower = String(message).toLowerCase();
      for (const forbidden of ["tenant", "plan_", "sql", "database", "override"]) {
        expect(lower).not.toContain(forbidden);
      }
    }
  });
});

describe("FeatureError", () => {
  it("carries the key for the server while the message stays user-facing", () => {
    const error = new FeatureError("reports", "entitlement");
    expect(error.featureKey).toBe("reports");
    expect(error.reason).toBe("entitlement");
    expect(error.name).toBe("FeatureError");
    expect(error.message).toBe(FEATURE_DENIAL_MESSAGES.entitlement);
    expect(error.message).not.toContain("reports");
  });

  it("is an Error, so an unhandled one still behaves", () => {
    expect(new FeatureError("team", "role")).toBeInstanceOf(Error);
  });
});
