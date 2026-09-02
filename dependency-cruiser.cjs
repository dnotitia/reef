const packageRoots = {
  core: "packages/core",
  web: "packages/web",
  jira: "packages/jira-migrator",
  orchestrator: "packages/orchestration/runtime",
  controller: "packages/orchestration/controller",
  cli: "packages/orchestration/cli",
  codex: "packages/orchestration/providers/codex",
  local: "packages/orchestration/providers/local",
  localValidation: "packages/orchestration/providers/local-validation",
  github: "packages/orchestration/providers/github",
  reef: "packages/orchestration/providers/reef",
  eventProcessor: "packages/event-processor",
};

const packagePath = (root) => `^${root}/(?:src|dist)(?:/|$)`;
const sourcePath =
  "^packages/(?:core|web|jira-migrator|event-processor|orchestration)/(?:src|dist)(?:/|$)";
const sourceExtension = "(?:js|jsx|ts|tsx|mjs|mts|cjs|cts)";
const testOrFixturePath = `(?:^|/)(?:__(?:test-helpers|stories|fixtures)__(?:/|$)|[^/]+\\.(?:test|spec|testSupport|stories)\\.${sourceExtension}|[^/]+(?:TestSupport|Fixtures)\\.${sourceExtension}|fixtures(?:/|\\.${sourceExtension}$))`;
const productionSource = {
  path: sourcePath,
  pathNot: testOrFixturePath,
};
const workspacePackageNames = Object.keys(packageRoots);
const dependencyTypes = [
  "npm",
  "npm-dev",
  "npm-optional",
  "npm-peer",
  "npm-bundled",
  "npm-no-pkg",
];

function forbiddenWorkspaceDirection(name, allowedNames) {
  const forbiddenNames = workspacePackageNames.filter(
    (candidate) => candidate !== name && !allowedNames.includes(candidate),
  );
  return {
    name: `workspace-${name}-boundary`,
    comment: `The ${name} package may only depend on its declared workspace package directions.`,
    severity: "error",
    from: { path: packagePath(packageRoots[name]) },
    to: {
      path: forbiddenNames.map((candidate) =>
        packagePath(packageRoots[candidate]),
      ),
    },
  };
}

module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment: "Workspace modules must not contain circular dependencies.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-unresolved",
      comment:
        "Every imported module must resolve to a file or declared package.",
      severity: "error",
      from: productionSource,
      to: { couldNotResolve: true },
    },
    {
      name: "no-production-to-test-or-fixture",
      comment:
        "Production modules must not depend on tests, fixtures, or test helpers.",
      severity: "error",
      from: productionSource,
      to: { path: testOrFixturePath },
    },
    forbiddenWorkspaceDirection("core", []),
    forbiddenWorkspaceDirection("web", ["core"]),
    forbiddenWorkspaceDirection("jira", ["core"]),
    forbiddenWorkspaceDirection("orchestrator", ["core"]),
    forbiddenWorkspaceDirection("controller", ["orchestrator"]),
    forbiddenWorkspaceDirection("cli", [
      "core",
      "orchestrator",
      "controller",
      "cli",
      "codex",
      "local",
      "localValidation",
      "github",
      "reef",
    ]),
    forbiddenWorkspaceDirection("codex", ["orchestrator"]),
    forbiddenWorkspaceDirection("local", ["orchestrator"]),
    forbiddenWorkspaceDirection("localValidation", ["orchestrator"]),
    forbiddenWorkspaceDirection("github", ["orchestrator"]),
    forbiddenWorkspaceDirection("reef", ["core", "orchestrator"]),
    forbiddenWorkspaceDirection("eventProcessor", ["core"]),
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
      dependencyTypes,
    },
    preserveSymlinks: false,
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.dependency-cruiser.json",
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "node", "default", "types"],
      extensions: [
        ".js",
        ".jsx",
        ".ts",
        ".tsx",
        ".mjs",
        ".cjs",
        ".mts",
        ".cts",
      ],
    },
  },
};
