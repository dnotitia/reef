// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "../../..");

describe("schema migration deployment contract", () => {
  it("ships a dependency-complete directly executable ESM runner", () => {
    const dockerfile = readFileSync(join(repoRoot, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("@reef/schema-migrator run build");
    expect(dockerfile).toContain(
      "/app/packages/schema-migrator/dist/cli.mjs ./schema-migrator/cli.mjs",
    );

    const packageJson = JSON.parse(
      readFileSync(
        join(repoRoot, "packages/schema-migrator/package.json"),
        "utf8",
      ),
    );
    expect(packageJson.type).toBe("module");
    expect(packageJson.scripts.build).toContain("--bundle");
    expect(packageJson.scripts.build).toContain("--format=esm");
  });

  it("uses Recreate and injects the external migration secret only into init", () => {
    const deployment = readFileSync(
      join(repoRoot, "deploy/k8s/base/deployment.yaml"),
      "utf8",
    );
    expect(deployment).toContain("type: Recreate");
    expect(deployment).toContain("initContainers:");
    expect(deployment).toContain(
      'command: ["node", "/app/schema-migrator/cli.mjs"]',
    );
    expect(deployment.match(/name: reef-schema-migrator-secret/g)).toHaveLength(
      1,
    );
    const appContainer = deployment.split("      containers:")[1] ?? "";
    expect(appContainer).not.toContain("reef-schema-migrator-secret");
    expect(deployment).not.toMatch(/^kind: Job$/m);
    const configMap = readFileSync(
      join(repoRoot, "deploy/k8s/base/configmap.yaml"),
      "utf8",
    );
    expect(configMap).toContain('REEF_SCHEMA_EXPECTED_WORKSPACES: "[]"');
  });
});
