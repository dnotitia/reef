# @reef/orchestration-cli

Private foreground adapter for one work-URI invocation.

The package exposes the same strict config, provider resolver, progress event,
terminal result, and runner seam to human and agent callers. Its executable
artifact accepts one invocation:

```text
run <canonical-work-uri> --config <absolute-json-path>
```

The adapter reads one Reef work snapshot, builds an immutable provider-bound
`RunPlan`, claims the controller, and delegates the one-run boundary to
`@reef/orchestrator`. It does not choose queued work, start a daemon, create a
workspace, run validation, or deliver a branch or pull request. Successful
invocation-only results therefore contain no delivery artifacts and explicitly
leave the delivery handoff for the caller.

Credentials are never accepted in argv or JSON. The config names the exact
environment variables to read; values are resolved once before provider
construction and are never copied into the plan, controller state, progress,
or terminal result.
