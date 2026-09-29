/**
 * Guard for the tsx-run billing DB scripts (test:billing, test:billing:strict, verify:billing).
 * Import it FIRST, before any "@/lib/…" module.
 *
 * Why: these .mts scripts import TypeScript modules that tsx serves to Node as CommonJS. On
 * Node 20 and on Node 22 before 22.23, Node's ESM loader evaluates such a module through its
 * own translator (loadCJSModule) without registering it in require.cache, so a module imported
 * by the script AND required by another module (e.g. @/lib/rbac) is evaluated twice. Two copies
 * of ScopeError/PermissionError make `instanceof` false and the checks fail misleadingly.
 * Node 24 (and 22.23+) share one instance. Pinned to 24, the version CI runs these on.
 */
const [major] = process.versions.node.split(".").map(Number);
if (major < 24) {
  console.error(
    `These billing DB scripts need Node 24 (running ${process.version}). On older Node, tsx loads ` +
      "@/lib modules twice, so error-class checks fail misleadingly. Switch to Node 24 (e.g. `nvm use 24`) and re-run.",
  );
  process.exit(1);
}
export {};
