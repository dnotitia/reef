#!/usr/bin/env node

import { USAGE } from "./parser.js";
import { type ProgressEvent, TerminalResultSchema } from "./result.js";
import {
  type CliRunnerDependencies,
  createTerminalFailure,
  runCliInvocation,
  shutdownController,
} from "./runner.js";

const MAX_PROGRESS_EVENTS = 64;
const MAX_PROGRESS_BYTES = 64 * 1024;

export interface CliProcessIO {
  readonly stdout?: (value: string) => void;
  readonly stderr?: (value: string) => void;
}

class ProgressWriter {
  private eventCount = 0;
  private bytes = 0;

  constructor(private readonly write: (value: string) => void) {}

  writeEvent(event: ProgressEvent): void {
    if (this.eventCount >= MAX_PROGRESS_EVENTS) return;
    const line = `${JSON.stringify(event)}\n`;
    const bytes = Buffer.byteLength(line, "utf8");
    if (this.bytes + bytes > MAX_PROGRESS_BYTES) return;
    this.eventCount += 1;
    this.bytes += bytes;
    try {
      this.write(line);
    } catch {
      // Diagnostics are best-effort and never change the execution result.
    }
  }
}

const defaultIO: Required<CliProcessIO> = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  dependencies: Omit<CliRunnerDependencies, "signal" | "onEvent"> = {},
  io: CliProcessIO = defaultIO,
): Promise<number> {
  const output = io.stdout ?? defaultIO.stdout;
  const diagnostics = io.stderr ?? defaultIO.stderr;
  const progress = new ProgressWriter(diagnostics);
  const shutdown = shutdownController();
  try {
    const result = await runCliInvocation(argv, {
      ...dependencies,
      signal: shutdown.signal,
      onEvent: (event) => progress.writeEvent(event),
    });
    if ("help" in result) {
      output(`${USAGE}\n`);
      return 0;
    }

    const parsed = TerminalResultSchema.safeParse(result.terminal);
    if (!parsed.success) {
      const fallback = createTerminalFailure(
        result.terminal.run_id,
        result.terminal.work_uri,
        new Error("terminal_schema_invalid"),
      );
      output(`${JSON.stringify(fallback.terminal)}\n`);
      return 1;
    }
    try {
      output(`${JSON.stringify(parsed.data)}\n`);
    } catch {
      return 1;
    }
    return result.exitCode;
  } catch {
    const fallback = createTerminalFailure(
      "run-unhandled",
      null,
      new Error("execution_failed"),
    );
    try {
      output(`${JSON.stringify(fallback.terminal)}\n`);
    } catch {
      return 1;
    }
    return 1;
  } finally {
    shutdown.dispose();
  }
}

if (process.argv[1]?.endsWith("/cli.js")) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
