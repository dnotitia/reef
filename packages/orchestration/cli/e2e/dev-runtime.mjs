import { createFixture } from "./fixture.mjs";

let fixture;
let stopping = false;

const stop = async () => {
  if (stopping) return;
  stopping = true;
  if (fixture) await fixture.dispose();
};

const waitForSignal = () =>
  new Promise((resolve) => {
    const onSignal = () => {
      void stop().finally(resolve);
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });

try {
  fixture = await createFixture({ runWindowMs: 30_000 });
  process.stdout.write(`REEF_E2E_READY=1\n`);
  process.stdout.write(`REEF_E2E_WORK_URI=${fixture.workUri}\n`);
  process.stdout.write(`REEF_E2E_PORT=${fixture.port}\n`);
  process.stdout.write(`REEF_E2E_CLI_COMMAND=${fixture.directCommand()}\n`);
  process.stdout.write(
    `REEF_E2E_INVALID_CONFIG_COMMAND=${fixture.directCommand(fixture.invalidConfigPath)}\n`,
  );
  process.stdout.write(
    `REEF_E2E_PROVIDER_MISMATCH_COMMAND=${fixture.directCommand(fixture.providerMismatchConfigPath)}\n`,
  );
  process.stdout.write(
    `REEF_E2E_DUPLICATE_COMMAND=${fixture.directCommand()}\n`,
  );
  process.stdout.write(`REEF_E2E_CANCEL_COMMAND=${fixture.directCommand()}\n`);
  process.stdout.write(
    `REEF_E2E_STOP=send SIGINT or SIGTERM to this runtime PID ${process.pid}\n`,
  );
  await waitForSignal();
} catch {
  await stop();
  process.stdout.write("REEF_E2E_READY=0\n");
  process.exitCode = 1;
}
