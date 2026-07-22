import { type ChildProcess, spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const MIGRATION_ONLY_ENV = ["REEF_SCHEMA_MIGRATION_KEY"] as const;

type Spawn = typeof spawn;

export function migrationFreeEnvironment(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const child = { ...source };
  for (const name of MIGRATION_ONLY_ENV) delete child[name];
  return child;
}

function waitForChild(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`child exited from signal ${signal}`));
      else resolve(code ?? 1);
    });
  });
}

export async function runDev(
  spawnImpl: Spawn = spawn,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const migration = spawnImpl(
    "pnpm",
    ["--filter", "@reef/schema-migrator", "run", "start"],
    { stdio: "inherit", env },
  );
  const migrationCode = await waitForChild(migration);
  if (migrationCode !== 0) return migrationCode;

  const web = spawnImpl("pnpm", ["--filter", "@reef/web", "dev"], {
    stdio: "inherit",
    env: migrationFreeEnvironment(env),
  });
  const forward = (signal: NodeJS.Signals) => web.kill(signal);
  process.once("SIGINT", forward);
  process.once("SIGTERM", forward);
  try {
    return await waitForChild(web);
  } finally {
    process.off("SIGINT", forward);
    process.off("SIGTERM", forward);
  }
}

async function main(): Promise<void> {
  try {
    process.exitCode = await runDev();
  } catch {
    process.stderr.write("Development startup failed.\n");
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
