export interface ShutdownController {
  signal: AbortSignal;
  dispose: () => void;
}

interface ProcessSignalTarget {
  once: (signal: NodeJS.Signals, listener: NodeJS.SignalsListener) => unknown;
  off: (signal: NodeJS.Signals, listener: NodeJS.SignalsListener) => unknown;
}

export function installShutdownHandlers(
  target: ProcessSignalTarget = process,
): ShutdownController {
  const controller = new AbortController();
  const abort = (signal: NodeJS.Signals) => {
    if (!controller.signal.aborted) controller.abort(signal);
  };

  target.once("SIGINT", abort);
  target.once("SIGTERM", abort);

  return {
    signal: controller.signal,
    dispose: () => {
      target.off("SIGINT", abort);
      target.off("SIGTERM", abort);
    },
  };
}
