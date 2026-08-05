import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodexHarnessProvider } from "../dist/index.js";

const codexExecutable =
  process.env.REEF_CODEX_EXECUTABLE ??
  "/Users/jylkim/.nvm/versions/node/v24.18.0/bin/codex";
const scratchDirectory = mkdtempSync(join(tmpdir(), "reef-codex-smoke-"));
let provider;
let session;

const runGit = (args) =>
  execFileSync("git", ["-C", scratchDirectory, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

try {
  runGit(["init", "-q"]);
  runGit(["config", "user.email", "reef-codex-smoke@example.invalid"]);
  runGit(["config", "user.name", "Reef Codex Smoke"]);
  writeFileSync(join(scratchDirectory, "README.md"), "scratch\n", "utf8");
  runGit(["add", "README.md"]);
  runGit(["commit", "-q", "-m", "scratch"]);

  provider = createCodexHarnessProvider({ executable: codexExecutable });
  session = await provider.start(
    {
      workUri: "reef://live-smoke/smoke",
      instruction:
        "Read README.md and return a completed structured result. Do not modify files, use tools only when needed, and do not include any secrets.",
      repositoryCwd: scratchDirectory,
      executionPolicy: {
        sandboxMode: "read-only",
        writableRoots: [],
        networkAccess: false,
        approvalMode: "never",
        environment: {
          HOME: process.env.HOME ?? "",
          PATH: process.env.PATH ?? "",
        },
      },
    },
    {},
  );

  const eventKinds = [];
  let terminal = null;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline && terminal === null) {
    const observation = await provider.observe(
      { session: session.session },
      {},
    );
    eventKinds.push(...observation.events.map((event) => event.type));
    terminal =
      observation.events.find((event) => event.type === "terminal") ?? null;
    if (terminal === null)
      await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const revision = runGit(["rev-parse", "HEAD"]);
  if (terminal === null || terminal.outcome !== "completed") {
    throw new Error("codex_live_smoke_terminal_failed");
  }

  await provider.stop({ session: session.session }, {});

  const cliVersionOutput = execFileSync(codexExecutable, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const cliVersion =
    cliVersionOutput.match(/^codex-cli\s+\S+/)?.[0] ?? "codex-cli unknown";

  process.stdout.write(
    `${JSON.stringify({
      cli: cliVersion,
      scratchRevision: revision,
      eventKinds: [...new Set(eventKinds)],
      terminal: terminal.outcome,
      childStopped: true,
    })}\n`,
  );
} finally {
  if (provider && session) {
    try {
      await provider.stop({ session: session.session }, {});
    } catch {
      // The smoke must not leave a child behind when an assertion fails.
    }
  }
  rmSync(scratchDirectory, { recursive: true, force: true });
}
