import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import { ControllerError } from "./errors.js";
import { type ProcessIdentity, ProcessIdentitySchema } from "./schema.js";

const execFile = promisify(execFileCallback);

export type ProcessLiveness = "alive" | "dead" | "unknown";
export type MaybePromise<T> = T | PromiseLike<T>;

export interface ProcessIdentityProbe {
  readonly current: () => MaybePromise<ProcessIdentity>;
  readonly probe: (identity: ProcessIdentity) => MaybePromise<ProcessLiveness>;
}

const fallbackStartTime = `fallback-${randomUUID()}`;

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

const readLinuxStartTime = async (pid: number): Promise<string | null> => {
  try {
    const raw = await readFile(`/proc/${pid}/stat`, "utf8");
    const closingParen = raw.lastIndexOf(")");
    if (closingParen < 0) return null;
    const fields = raw
      .slice(closingParen + 2)
      .trim()
      .split(/\s+/);
    const startTime = fields[19];
    return startTime && /^\d+$/.test(startTime) ? startTime : null;
  } catch {
    return null;
  }
};

const readPortableStartTime = async (pid: number): Promise<string | null> => {
  try {
    const result = await execFile("ps", ["-p", String(pid), "-o", "lstart="]);
    const value = result.stdout.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
};

const readStartTime = async (pid: number): Promise<string | null> =>
  (await readLinuxStartTime(pid)) ?? (await readPortableStartTime(pid));

const currentIdentity = async (): Promise<ProcessIdentity> => {
  const pid = process.pid;
  const startTime = (await readStartTime(pid)) ?? fallbackStartTime;
  const parsed = ProcessIdentitySchema.safeParse({ pid, startTime });
  if (!parsed.success) throw new ControllerError("process_identity_invalid");
  return parsed.data;
};

const probeIdentity = async (
  identity: ProcessIdentity,
): Promise<ProcessLiveness> => {
  const observed = await readStartTime(identity.pid);
  if (observed !== null)
    return observed === identity.startTime ? "alive" : "dead";

  if (identity.pid !== process.pid) return "unknown";
  try {
    process.kill(identity.pid, 0);
  } catch (error) {
    if (isNodeError(error) && error.code === "ESRCH") return "dead";
    return "unknown";
  }
  return identity.startTime === fallbackStartTime ? "alive" : "unknown";
};

export const defaultProcessIdentityProbe: ProcessIdentityProbe = {
  current: currentIdentity,
  probe: probeIdentity,
};
