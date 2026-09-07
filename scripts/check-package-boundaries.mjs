// Enforces the import direction in docs/architecture.md section 8. Run with `pnpm check:boundaries`.
//
// The rules protect two things a type error would not catch:
//   1. `db` and `server` must never reach a mobile bundle, including through a barrel export or a
//      relative path that walks out of a package. That is what keeps database credentials,
//      provider secrets, and privileged SDK clients off a device.
//   2. `contracts` and `domain` stay leaf packages, and neither app imports the other.
//
// This is a static scan of import specifiers, not a resolver: it reads what a file asks for. A
// dynamic `import(variable)` is invisible to it, so it is a guard rail, not a proof.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SERVER_ONLY_PACKAGES = ["db", "server"];

/** Client packages plus both apps: none of them may reach server-only code. */
const CLIENT_PACKAGES = ["ui", "features", "mobile", "api-client", "contracts", "domain"];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIP_DIRECTORIES = new Set(["node_modules", "dist", "build", ".expo", "__snapshots__"]);

// `import x from "y"`, `export * from "y"`, `import("y")`, and `require("y")`. Deliberately simple:
// a specifier that is not a literal is not a boundary this scan can decide.
const IMPORT_PATTERNS = [
  /\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\s+["']([^"']+)["']/g,
];

function listSourceFiles(directory) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".well-known") continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      files.push(...listSourceFiles(full));
      continue;
    }
    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(full);
  }
  return files;
}

/** Every scanned root, tagged with the boundary scope its files belong to. */
function scanRoots() {
  const roots = [];
  for (const name of directoryNames(path.join(repoRoot, "packages"))) {
    roots.push({
      scope: { kind: "package", name },
      directory: path.join(repoRoot, "packages", name, "src"),
    });
  }
  for (const name of directoryNames(path.join(repoRoot, "apps"))) {
    for (const sub of ["app", "src"]) {
      roots.push({
        scope: { kind: "app", name },
        directory: path.join(repoRoot, "apps", name, sub),
      });
    }
  }
  return roots.filter((root) => isDirectory(root.directory));
}

function directoryNames(parent) {
  try {
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !SKIP_DIRECTORIES.has(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function isDirectory(candidate) {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function readImports(file) {
  const source = readFileSync(file, "utf8");
  const lines = source.split(/\r?\n/);
  const found = [];
  lines.forEach((line, index) => {
    for (const pattern of IMPORT_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(line)) !== null) {
        found.push({ specifier: match[1], line: index + 1 });
      }
    }
  });
  return found;
}

/**
 * Resolves a specifier to the workspace location it names, or null when it points outside the
 * monorepo. A relative import is resolved against the importing file so `../../db/src/client`
 * cannot dodge the `@handoff/db` rule.
 */
function locate(specifier, fromFile) {
  const workspaceMatch = /^@handoff\/([^/]+)/.exec(specifier);
  if (workspaceMatch !== null) {
    const name = workspaceMatch[1];
    if (name === "parents" || name === "daycare") return { kind: "app", name };
    return { kind: "package", name };
  }
  if (!specifier.startsWith(".")) return null;

  const resolved = path.resolve(path.dirname(fromFile), specifier);
  const relative = path.relative(repoRoot, resolved).split(path.sep);
  if (relative[0] === "packages" && relative.length > 1) {
    return { kind: "package", name: relative[1] };
  }
  if (relative[0] === "apps" && relative.length > 1) {
    return { kind: "app", name: relative[1] };
  }
  return null;
}

function violationFor(scope, target, specifier) {
  if (target === null) return null;
  const isSameUnit = target.kind === scope.kind && target.name === scope.name;
  if (isSameUnit) return null;

  const isClientScope =
    (scope.kind === "package" && CLIENT_PACKAGES.includes(scope.name)) ||
    (scope.kind === "app" && (scope.name === "parents" || scope.name === "daycare"));

  if (isClientScope && target.kind === "package" && SERVER_ONLY_PACKAGES.includes(target.name)) {
    return `imports server-only "${specifier}"; @handoff/${target.name} must never reach a mobile bundle`;
  }

  if (scope.kind === "app" && target.kind === "app") {
    return `imports the other app through "${specifier}"; neither app may depend on the other`;
  }

  if (scope.kind === "package" && scope.name === "contracts" && target.kind === "package") {
    return `imports "${specifier}"; contracts is a leaf package and imports no other @handoff package`;
  }

  if (
    scope.kind === "package" &&
    scope.name === "domain" &&
    target.kind === "package" &&
    target.name !== "contracts"
  ) {
    return `imports "${specifier}"; domain may only import @handoff/contracts`;
  }

  return null;
}

function main() {
  const violations = [];
  for (const root of scanRoots()) {
    for (const file of listSourceFiles(root.directory)) {
      for (const { specifier, line } of readImports(file)) {
        const reason = violationFor(root.scope, locate(specifier, file), specifier);
        if (reason === null) continue;
        violations.push({
          location: `${path.relative(repoRoot, file).replaceAll(path.sep, "/")}:${line}`,
          reason,
        });
      }
    }
  }

  if (violations.length === 0) {
    console.info("package boundaries: no violations");
    return;
  }

  console.error(`package boundaries: ${violations.length} violation(s)`);
  for (const violation of violations) {
    console.error(`  ${violation.location}  ${violation.reason}`);
  }
  console.error("See docs/architecture.md section 8 for the allowed import direction.");
  process.exit(1);
}

main();
