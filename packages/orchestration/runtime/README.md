# @reef/orchestrator

Provider-neutral execution core for Reef's process boundary.

This package owns one immutable `RunPlan` execution envelope: provider registry
preflight, the running callback, lifecycle events, cancellation, cleanup, and
safe terminal result normalization. A caller supplies the provider registry and
one execution callback through the same `executeRunPlan` entrypoint. Scheduling,
queue selection, persistence, delivery sequencing, and concrete provider
adapters belong to their respective callers and follow-on packages.

The package has no Reef configuration loader, environment alias, executable,
AKB/GitHub/LLM dependency, or public CLI. Signal registration remains available
through `installShutdownHandlers` for callers that own a process lifecycle.

Its provider-neutral validation contract carries an exact candidate and contract
revision plus a frozen ordered list of named commands and positive timeouts.
Validation results preserve check order and bounded proof metadata; concrete
process execution belongs to a provider such as
`@reef/validation-provider-local`.

```ts
import {
  executeRunPlan,
  installShutdownHandlers,
} from "@reef/orchestrator";

const shutdown = installShutdownHandlers();
const result = await executeRunPlan(plan, providers, async (context) => {
  const work = await context.invoke("work", "read", { uri: plan.work.uri });
  context.registerCleanup(() => release(work));
}, { signal: shutdown.signal });
shutdown.dispose();
```

Execution cancellation is distinct from ordinary failure. Registered cleanup
actions always run in reverse registration order, exactly once, and continue
after an individual cleanup failure. Terminal results and lifecycle events carry
only provider metadata, plan provenance, normalized failures, and cleanup
outcomes; they never include raw thrown values, credentials, prompts, or
upstream payloads.
