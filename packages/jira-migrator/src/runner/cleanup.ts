export async function finalizeJiraCleanup(input: {
  steps: readonly (() => Promise<void>)[];
  primaryError?: unknown;
}): Promise<void> {
  const cleanupErrors: unknown[] = [];
  for (const step of input.steps) {
    try {
      await step();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      input.primaryError === undefined
        ? cleanupErrors
        : [input.primaryError, ...cleanupErrors],
      "jira_migration_cleanup_failed",
    );
  }
}
