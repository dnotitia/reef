# @reef/orchestration-controller

`@reef/orchestration-controller`는 foreground 실행 하나의 controller-owned
local state와 recovery 경계를 제공하는 private package입니다.

상태는 caller가 지정한 private directory에 version-1 strict JSON record와
work-URI SHA-256 claim으로 저장됩니다. 새 실행은 `prepared`로 claim되고,
phase·workspace reference·artifact·terminal result·explicit interruption은
monotonic revision으로 atomic하게 갱신됩니다. terminal/interrupted 상태의
claim은 logical release marker로 바뀌고, cleanup callback이 성공한 뒤 record와
claim이 함께 제거됩니다. 따라서 callback 실패나 process identity 불명 시
재검사와 재시도를 위해 journal이 남습니다.

```ts
import { createControllerStore } from "@reef/orchestration-controller";

const controller = createControllerStore({
  stateRoot: "/var/lib/reef/controller",
  staleAfterMs: 15 * 60 * 1000,
  redactionValues: ["deployment-secret"],
});

const state = await controller.claim({ runId, plan });
await controller.update({
  runId: state.runId,
  operation: { type: "phase", phase: "preflight" },
});

const inspection = await controller.inspect(plan.work.uri);
if (inspection.allowedActions.includes("cleanup")) {
  await controller.cleanup(plan.work.uri, async (workspace, signal) => {
    await infrastructureCleanup(workspace, signal);
  });
}
```

The package intentionally does not resume a run, choose a queue, compose
providers, expose a command, write to Reef/AKB, or infer a filesystem path from
an opaque provider reference. Runtime execution remains in `@reef/orchestrator`;
callers connect runtime events to the narrow update operations here.
