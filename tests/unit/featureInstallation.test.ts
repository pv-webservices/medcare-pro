import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MissingFeaturesBanner from "@/components/settings/MissingFeaturesBanner";
import { DEFAULT_FEATURES } from "@/lib/defaultFeatures";
import {
  FEATURE_INSTALL_COMMANDS,
  missingCatalogueFeatures,
  PERMISSION_GROUP_FEATURES,
  SEED_COMMAND,
  uninstalledPermissionModules,
} from "@/lib/featureInstallation";
import { PERMISSION_GROUPS } from "@/lib/permissions";

const ALL_KEYS = DEFAULT_FEATURES.map((feature) => feature.key);

describe("missing catalogue features", () => {
  it("reports nothing when every catalogue feature is installed", () => {
    expect(missingCatalogueFeatures(ALL_KEYS)).toEqual([]);
  });

  it("names billing with its backfill command when its row is missing", () => {
    expect(missingCatalogueFeatures(ALL_KEYS.filter((key) => key !== "billing"))).toEqual([{
      key: "billing", name: "Patient billing", command: "npm run billing:backfill",
      message: "Patient billing is available in this version but not installed on this database. An administrator must run: npm run billing:backfill",
    }]);
  });

  it("falls back to the seed for a feature with no dedicated script", () => {
    const [reports] = missingCatalogueFeatures(ALL_KEYS.filter((key) => key !== "reports"));
    expect(reports.command).toBeNull();
    expect(reports.message).toMatch(new RegExp(`must run the seed: ${SEED_COMMAND}$`));
  });

  it("ignores extra keys in the database and keeps catalogue order", () => {
    const missing = missingCatalogueFeatures(["legacy_module", "registrations"]);
    expect(missing.map((feature) => feature.key)).toEqual(ALL_KEYS.filter((key) => key !== "registrations"));
  });

  it("maps only real catalogue features and real package scripts", async () => {
    const scripts = (await import("../../package.json")).default.scripts as Record<string, string>;
    for (const [key, command] of Object.entries(FEATURE_INSTALL_COMMANDS)) {
      expect(ALL_KEYS).toContain(key);
      expect(scripts[command.replace("npm run ", "")]).toBeDefined();
    }
    expect(scripts[SEED_COMMAND.replace("npm run ", "")]).toBeDefined();
  });
});

describe("Roles & Permissions module notes", () => {
  it("maps only real permission groups to real catalogue features", () => {
    const groups = PERMISSION_GROUPS.map((group) => group.module);
    for (const [module, key] of Object.entries(PERMISSION_GROUP_FEATURES)) {
      expect(groups).toContain(module);
      expect(ALL_KEYS).toContain(key);
    }
  });

  it("flags the Billing group when billing is not installed", () => {
    expect(uninstalledPermissionModules([{ key: "billing" }])).toEqual(["Billing"]);
    expect(uninstalledPermissionModules([{ key: "whatsapp" }, { key: "settings" }])).toEqual(["Messages"]);
    expect(uninstalledPermissionModules([])).toEqual([]);
  });
});

describe("MissingFeaturesBanner", () => {
  it("renders nothing when every feature is installed", () => {
    expect(renderToStaticMarkup(createElement(MissingFeaturesBanner, { missing: [] }))).toBe("");
  });

  it("lists each missing feature with its install command", () => {
    const html = renderToStaticMarkup(createElement(MissingFeaturesBanner, { missing: missingCatalogueFeatures(ALL_KEYS.filter((key) => key !== "billing")) }));
    expect(html).toContain('role="status"');
    expect(html).toContain("A module is not installed on this database");
    expect(html).toContain("Patient billing is available in this version but not installed on this database. An administrator must run: npm run billing:backfill");
  });
});
