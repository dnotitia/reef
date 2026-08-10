import {
  ExecutionBlockedError,
  ExecutionTaskError,
  invokeProviderOperation,
  type ExecutionContext,
  type HarnessObservationEvent,
  type ProviderArtifact,
  type ProviderReference,
  type ValidationProof,
} from "@reef/orchestrator";
import { providerConfigFor, type CliConfig } from "./config.js";
import type { ResolvedProviders } from "./providers.js";
import type { DeliveryProgressEvent } from "./result.js";

export interface BlockedQuestionChoice {
  readonly label: string;
  readonly description: string;
}

export interface BlockedQuestionSummaryInput {
  readonly question: string;
  readonly choices: readonly BlockedQuestionChoice[];
  readonly recommendation: string;
  readonly impact: string;
}

const compact = (value: string, maximum = 512): string =>
  [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f ? " " : character;
    })
    .join("")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximum);

const sentence = (value: string): string =>
  /[.!?]$/u.test(value) ? value : `${value}.`;

export function blockedQuestionSummary(
  input: BlockedQuestionSummaryInput,
): string {
  return [
    `Question: ${compact(input.question)}`,
    `Choices: ${input.choices
      .slice(0, 3)
      .map(
        (choice) =>
          `${compact(choice.label, 128)} — ${compact(choice.description, 256)}`,
      )
      .join("; ")}`,
    `Recommendation: ${sentence(compact(input.recommendation, 128))}`,
    `Impact: ${sentence(compact(input.impact))}`,
  ].join(" ");
}

export interface DeliveryControllerHooks {
  readonly setWorkspace: (reference: ProviderReference) => Promise<void>;
  readonly addArtifact: (artifact: ProviderArtifact) => Promise<void>;
  readonly emitProgress?: (event: DeliveryProgressEvent) => void;
}

export interface DeliveryResult {
  readonly artifacts: readonly ProviderArtifact[];
  readonly validatedRevision: string;
}

const providerContext = (context: ExecutionContext) => ({
  signal: context.signal,
  correlationId: context.plan.work.uri,
});

const waitForObservation = async (signal: AbortSignal): Promise<void> => {
  if (signal.aborted) throw new DOMException("cancelled", "AbortError");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, 25);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("cancelled", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
};

const taskFailure = (code: string): ExecutionTaskError =>
  new ExecutionTaskError(code);

const requireValidationProof = (
  proof: ValidationProof | null,
): ValidationProof => {
  if (proof === null) throw taskFailure("validation_not_requested");
  return proof;
};

const firstValidationFailure = (proof: ValidationProof) => {
  const failed = proof.checks.find((check) => check.status !== "passed");
  return {
    name: failed?.name ?? "validation",
    status: failed?.status ?? "failed",
    summary: failed?.summary ?? "validation did not pass",
  };
};

const emitValidationProgress = (
  hooks: DeliveryControllerHooks,
  context: ExecutionContext,
  stage: DeliveryProgressEvent["stage"],
  attempt: number,
  candidateRevision: string,
  previousCandidateRevision?: string,
  check?: DeliveryProgressEvent["check"],
): void => {
  hooks.emitProgress?.({
    schema_version: 1,
    event: "execution.validation",
    at: context.now().toISOString(),
    work_uri: context.plan.work.uri,
    stage,
    attempt,
    candidate_revision: candidateRevision,
    ...(previousCandidateRevision
      ? { previous_candidate_revision: previousCandidateRevision }
      : {}),
    ...(check ? { check } : {}),
  });
};

const choicesFromEvent = (
  event: Extract<
    HarnessObservationEvent,
    { readonly type: "user_input_request" }
  >,
): BlockedQuestionSummaryInput => {
  const question = event.questions[0];
  const choices = (question?.choices ?? []).slice(0, 3).map((choice) => ({
    label: compact(choice.label, 128),
    description: compact(choice.description, 256),
  }));
  while (choices.length < 2) {
    choices.push(
      choices.length === 0
        ? {
            label: "Stop",
            description: "Keep this task in progress for a later decision.",
          }
        : {
            label: "Ask again",
            description: "Return one clarified question to the requester.",
          },
    );
  }
  return {
    question: question?.question ?? "Codex needs a decision before continuing.",
    choices,
    recommendation: choices[0]?.label ?? "Stop",
    impact:
      "The recommended choice keeps the task in progress; another choice may require additional setup or clarification.",
  };
};

const approvalSummary = (
  event: Extract<
    HarnessObservationEvent,
    { readonly type: "approval_blocked" }
  >,
): string =>
  blockedQuestionSummary({
    question: "Should the blocked Codex action be allowed?",
    choices: [
      {
        label: "Allow",
        description: "Allow this action and continue the run.",
      },
      {
        label: "Decline",
        description: "Decline the action and keep the task open.",
      },
      { label: "Stop", description: "Stop this run and decide later." },
    ],
    recommendation: "Decline",
    impact: `The action remains blocked (${compact(event.approval, 64)}); no automatic approval is sent.`,
  });

const reportBlocked = async (
  context: ExecutionContext,
  revision: string,
  summary: string,
): Promise<never> => {
  await context.invoke("work", "report", {
    uri: context.plan.work.uri,
    revision,
    outcome: "pending",
    summary,
  });
  throw new ExecutionBlockedError();
};

const describeWorkspace = async (
  context: ExecutionContext,
  resolved: ResolvedProviders,
  resource: ProviderReference,
) => resolved.infrastructure.describe({ resource }, providerContext(context));

const linkArtifact = async (
  context: ExecutionContext,
  artifact: ProviderArtifact,
): Promise<void> => {
  await context.invoke("work", "linkArtifact", {
    uri: context.plan.work.uri,
    artifact,
  });
};

export async function runDelivery(
  context: ExecutionContext,
  config: CliConfig,
  resolved: ResolvedProviders,
  hooks: DeliveryControllerHooks,
): Promise<DeliveryResult> {
  const workUri = context.plan.work.uri;
  const current = await context.invoke("work", "refresh", {
    uri: workUri,
    revision: context.plan.work.snapshot.revision,
  });
  if (current.revision !== context.plan.work.snapshot.revision) {
    throw taskFailure("delivery_stale_work");
  }

  let workRevision = (
    await context.invoke("work", "transition", {
      uri: workUri,
      transition: "in_progress",
    })
  ).revision;

  const infrastructureConfig = providerConfigFor(config, "infrastructure");
  if (infrastructureConfig.kind !== "infrastructure") {
    throw taskFailure("delivery_configuration_invalid");
  }
  const provisioned = await context.invoke("infrastructure", "provision", {
    target: infrastructureConfig.options.target,
  });
  const resource = provisioned.resource;
  context.registerCleanup(async ({ invoke }) => {
    await invoke("infrastructure", "cleanup", { resource });
  });
  await hooks.setWorkspace(resource);

  const initialWorkspace = await describeWorkspace(context, resolved, resource);
  if (
    !initialWorkspace.clean ||
    initialWorkspace.revision !== resource.revision
  ) {
    throw taskFailure("managed_workspace_not_clean");
  }

  const bound = resolved.bindWorkspace(initialWorkspace);
  const scmContext = providerContext(context);
  await invokeProviderOperation(
    bound.scm,
    "createBranch",
    {
      repository: config.repository.id,
      branch: config.repository.branch,
    },
    scmContext,
  );

  const harness = await context.invoke("harness", "start", {
    workUri,
    instruction: [
      "Implement the requested Reef work item in the provided checkout.",
      `Work URI: ${workUri}.`,
      `Starting work revision: ${context.plan.work.snapshot.revision}.`,
      "Keep changes inside the checkout, request local validation when the implementation is ready, repair any failed checks with a new commit, and finish only after validation passes.",
    ].join(" "),
    repositoryCwd: initialWorkspace.cwd,
    executionPolicy: {
      sandboxMode: "workspace-write",
      writableRoots: [initialWorkspace.cwd],
      networkAccess: false,
      approvalMode: "never",
      environment: { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin" },
    },
  });
  const session = harness.session;
  context.registerCleanup(async ({ invoke }) => {
    await invoke("harness", "stop", { session });
  });

  let validationAttempts = 0;
  let failedCandidate: string | null = null;
  let validatedRevision: string | null = null;
  let validationProof: ValidationProof | null = null;
  let artifacts: ProviderArtifact[] = [];

  const performValidation = async (): Promise<void> => {
    validationAttempts += 1;
    if (validationAttempts > config.delivery.max_validation_attempts) {
      throw taskFailure("validation_budget_exhausted");
    }

    const beforeCommit = await describeWorkspace(context, resolved, resource);
    if (beforeCommit.clean)
      throw taskFailure("workspace_no_changes_before_commit");
    const committed = await invokeProviderOperation(
      bound.scm,
      "commit",
      {
        repository: config.repository.id,
        branch: config.repository.branch,
        message: `Implement ${workUri}`,
      },
      scmContext,
    );
    if (failedCandidate === committed.revision) {
      throw taskFailure("validation_candidate_not_new");
    }

    const afterCommit = await describeWorkspace(context, resolved, resource);
    if (!afterCommit.clean || afterCommit.revision !== committed.revision) {
      throw taskFailure("validation_head_mismatch");
    }

    if (failedCandidate !== null) {
      emitValidationProgress(
        hooks,
        context,
        "validation_repair",
        validationAttempts,
        committed.revision,
        failedCandidate,
      );
    }
    emitValidationProgress(
      hooks,
      context,
      "validation_attempt",
      validationAttempts,
      committed.revision,
    );

    const proof = await invokeProviderOperation(
      bound.validation,
      "validate",
      {
        candidateRevision: committed.revision,
        contractRevision: context.plan.inputProvenance.revision,
        checks: context.plan.validationChecks,
      },
      scmContext,
    );
    if (proof.status !== "passed") {
      failedCandidate = committed.revision;
      const failure = firstValidationFailure(proof);
      emitValidationProgress(
        hooks,
        context,
        "validation_failed",
        validationAttempts,
        committed.revision,
        undefined,
        {
          name: compact(failure.name, 128),
          status: failure.status,
          summary: compact(failure.summary, 512),
        },
      );
      await context.invoke("harness", "sendInput", {
        session,
        input: {
          type: "text",
          text: `Local validation failed. Check ${compact(failure.name, 128)} status ${compact(failure.status, 64)}: ${compact(failure.summary)}. Update the implementation and request validation again with a new commit.`,
        },
      });
      return;
    }

    validatedRevision = committed.revision;
    validationProof = proof;
    emitValidationProgress(
      hooks,
      context,
      "validation_passed",
      validationAttempts,
      committed.revision,
    );
    await context.invoke("harness", "sendInput", {
      session,
      input: {
        type: "text",
        text: `Local validation passed for candidate ${committed.revision}. Finish the implementation and return completed.`,
      },
    });
  };

  let completed = false;
  while (!completed) {
    const observation = await context.invoke("harness", "observe", { session });
    let validationSignals = 0;
    for (const event of observation.events) {
      if (event.type === "user_input_request") {
        const summary = blockedQuestionSummary(choicesFromEvent(event));
        await reportBlocked(context, workRevision, summary);
      }
      if (event.type === "approval_blocked") {
        await reportBlocked(context, workRevision, approvalSummary(event));
      }
      if (event.type === "validation_request") {
        await performValidation();
        validationSignals += 1;
      }
      if (event.type !== "terminal") continue;
      if (event.outcome === "validation_requested") {
        if (validationSignals === 0) await performValidation();
        else validationSignals -= 1;
        continue;
      }
      if (event.outcome === "blocked") {
        await reportBlocked(
          context,
          workRevision,
          blockedQuestionSummary({
            question: "Codex needs a decision before continuing.",
            choices: [
              {
                label: "Continue later",
                description: "Keep the task open for a decision.",
              },
              { label: "Stop", description: "Stop this run without delivery." },
            ],
            recommendation: "Continue later",
            impact:
              "The task remains in progress and no branch or review artifact is created.",
          }),
        );
      }
      if (event.outcome === "failed" || event.outcome === "interrupted") {
        throw taskFailure(
          event.outcome === "interrupted"
            ? "harness_interrupted"
            : "harness_failed",
        );
      }
      if (event.outcome === "completed") completed = true;
    }
    if (!completed) await waitForObservation(context.signal);
  }

  if (validatedRevision === null) {
    throw taskFailure("validation_not_requested");
  }
  const passedProof = requireValidationProof(validationProof);

  const finalWorkspace = await describeWorkspace(context, resolved, resource);
  if (!finalWorkspace.clean || finalWorkspace.revision !== validatedRevision) {
    throw taskFailure("delivery_head_mismatch");
  }
  const pushed = await invokeProviderOperation(
    bound.scm,
    "push",
    { repository: config.repository.id, ref: config.repository.branch },
    scmContext,
  );
  if (pushed.revision !== validatedRevision) {
    throw taskFailure("delivery_head_mismatch");
  }
  const pullRequest = await invokeProviderOperation(
    bound.scm,
    "createDraftPullRequest",
    {
      repository: config.repository.id,
      head: config.repository.branch,
      base: config.repository.base_branch,
      title: `Implement ${workUri}`,
      body: `Validated exact candidate ${validatedRevision} with ${
        passedProof.checks.length
      } local check(s).`,
    },
    scmContext,
  );

  const branchArtifact: ProviderArtifact = {
    kind: "branch",
    ref: config.repository.branch,
    ...(pushed.uri ? { uri: pushed.uri } : {}),
    title: "Issue branch",
  };
  const commitArtifact: ProviderArtifact = {
    kind: "commit",
    ref: validatedRevision,
    uri: `https://github.com/${config.repository.owner}/${config.repository.name}/commit/${validatedRevision}`,
    title: "Validated exact head",
  };
  const proofArtifact: ProviderArtifact = {
    kind: "proof",
    ref: validatedRevision,
    title: "Local validation passed",
  };
  artifacts = [branchArtifact, commitArtifact, proofArtifact, pullRequest];
  for (const artifact of [branchArtifact, commitArtifact, pullRequest]) {
    await linkArtifact(context, artifact);
  }
  for (const artifact of artifacts) await hooks.addArtifact(artifact);

  workRevision = (await context.invoke("work", "refresh", { uri: workUri }))
    .revision;
  await context.invoke("work", "report", {
    uri: workUri,
    revision: workRevision,
    outcome: "succeeded",
    summary: `Validated exact head ${validatedRevision} and created draft pull request ${pullRequest.ref}.`,
  });
  await context.invoke("work", "transition", {
    uri: workUri,
    transition: "in_review",
  });

  return { artifacts, validatedRevision };
}
