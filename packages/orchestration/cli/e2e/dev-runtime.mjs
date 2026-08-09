import { createFixture } from "./fixture.mjs";

let fixtures = [];
let stopping = false;

const stop = async () => {
  if (stopping) return;
  stopping = true;
  await Promise.all(fixtures.map((fixture) => fixture.dispose()));
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
  fixtures = await Promise.all(
    ["success", "repair", "blocked"].map((scenario) =>
      createFixture({ scenario }),
    ),
  );
  const [success, repair, blocked] = fixtures;
  process.stdout.write(`REEF_E2E_READY=1\n`);
  process.stdout.write(`REEF_E2E_CLI_BEHAVIOR_JOB=cli-e2e-runtime\n`);
  process.stdout.write(`REEF_E2E_SUCCESS_WORK_URI=${success.workUri}\n`);
  process.stdout.write(`REEF_E2E_REPAIR_WORK_URI=${repair.workUri}\n`);
  process.stdout.write(`REEF_E2E_BLOCKED_WORK_URI=${blocked.workUri}\n`);
  process.stdout.write(`REEF_E2E_SUCCESS_COMMAND=${success.directCommand()}\n`);
  process.stdout.write(`REEF_E2E_REPAIR_COMMAND=${repair.directCommand()}\n`);
  process.stdout.write(`REEF_E2E_BLOCKED_COMMAND=${blocked.directCommand()}\n`);
  process.stdout.write(
    `REEF_E2E_STOP=send SIGINT or SIGTERM to this runtime PID ${process.pid}\n`,
  );
  await waitForSignal();
} catch {
  await stop();
  process.stdout.write("REEF_E2E_READY=0\n");
  process.exitCode = 1;
}
