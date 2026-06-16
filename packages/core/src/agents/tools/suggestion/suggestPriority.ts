import { SpanStatusCode, trace } from "@opentelemetry/api";
import { tool } from "ai";
import { SchemaValidationError } from "../../../errors";
import {
  SuggestPriorityInputSchema,
  type SuggestPriorityOutput,
  SuggestPriorityOutputSchema,
} from "../../../schemas/ai/tools";
import type { Priority } from "../../../schemas/issues/metadata";

const tracer = trace.getTracer("@reef/core");

/**
 * suggest_priority — Returns a priority suggestion with rationale.
 *
 * No GitHub writes. Returns one of: "critical" | "high" | "medium" | "low"
 * along with a human-readable rationale string.
 */
export const suggestPriorityTool = tool({
  description:
    "Suggest a priority level (critical/high/medium/low) for a new issue based on its title, " +
    "content, and optional repo context. Returns the priority with rationale. Does NOT write to GitHub.",
  inputSchema: SuggestPriorityInputSchema,
  execute: async (input): Promise<SuggestPriorityOutput> => {
    return tracer.startActiveSpan(
      "reef.tool.suggest_priority",
      async (span) => {
        span.setAttribute("tool.input.title", input.title);
        try {
          const combined = `${input.title} ${input.content}`.toLowerCase();

          let priority: Priority = "medium";
          let rationale =
            "No strong signal detected; defaulting to medium priority.";

          if (
            /critical|urgent|outage|down|production|security|breach|data.?loss|blocker/.test(
              combined,
            )
          ) {
            priority = "critical";
            rationale =
              "Keywords suggest a production-blocking or security-critical issue.";
          } else if (
            /high|important|breaking|regression|performance|degradation|sev1/.test(
              combined,
            )
          ) {
            priority = "high";
            rationale =
              "Keywords suggest significant impact to functionality or performance.";
          } else if (
            /low|minor|cosmetic|typo|style|formatting|nice.?to.?have/.test(
              combined,
            )
          ) {
            priority = "low";
            rationale = "Keywords suggest a minor or cosmetic improvement.";
          }

          const output: SuggestPriorityOutput = { priority, rationale };
          const parsed = SuggestPriorityOutputSchema.safeParse(output);
          if (!parsed.success) {
            throw new SchemaValidationError({
              field: "suggestPriorityOutput",
              issues: parsed.error.issues.map((i) => i.message),
            });
          }

          span.setAttribute("tool.output.priority", priority);
          span.setStatus({ code: SpanStatusCode.OK });
          return parsed.data;
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          span.recordException(error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error.message,
          });
          throw err;
        } finally {
          span.end();
        }
      },
    );
  },
});
