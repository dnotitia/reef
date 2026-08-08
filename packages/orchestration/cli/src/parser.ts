import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { parseReefWorkUri } from "@reef/work-provider-reef";
import { type ParsedCliConfig, parseCliConfig } from "./config.js";

export interface InvocationArguments {
  readonly workUri: string;
  readonly configPath: string;
}

export class CliUsageError extends Error {
  readonly code = "usage_invalid" as const;
  readonly path: readonly (string | number)[];

  constructor(path: readonly (string | number)[] = ["argv"]) {
    super("usage_invalid");
    this.name = "CliUsageError";
    this.path = path;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface HelpRequest {
  readonly help: true;
}

export type ParsedArguments = InvocationArguments | HelpRequest;

const invalidPath = (value: string): boolean =>
  !isAbsolute(value) || value.split(/[\\/]+/u).includes("..");

export function parseInvocationArguments(
  argv: readonly string[],
): ParsedArguments {
  if (argv.length === 1 && argv[0] === "--help") return { help: true };
  if (argv.length !== 4 || argv[0] !== "run") throw new CliUsageError();

  const workUri = argv[1];
  if (!workUri) throw new CliUsageError(["argv", 1]);
  try {
    parseReefWorkUri(workUri);
  } catch {
    throw new CliUsageError(["work_uri"]);
  }

  if (argv[2] !== "--config") throw new CliUsageError(["argv", 2]);
  const configPath = argv[3];
  if (!configPath || invalidPath(configPath)) {
    throw new CliUsageError(["config_path"]);
  }

  return {
    workUri,
    configPath: resolve(configPath),
  };
}

export async function readInvocationConfig(
  invocation: InvocationArguments,
): Promise<ParsedCliConfig> {
  let raw: string;
  try {
    raw = await readFile(invocation.configPath, "utf8");
  } catch {
    throw new CliUsageError(["config"]);
  }

  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new CliUsageError(["config"]);
  }

  return parseCliConfig(value);
}

export const USAGE =
  "Usage: <private-foreground-artifact> run <canonical-work-uri> --config <absolute-json-path>";
