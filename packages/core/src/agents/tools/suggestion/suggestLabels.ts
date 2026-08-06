import { SpanStatusCode, trace } from "@opentelemetry/api";
import { tool } from "ai";
import { SchemaValidationError } from "../../../errors";
import {
  SuggestLabelsInputSchema,
  type SuggestLabelsOutput,
  SuggestLabelsOutputSchema,
} from "../../../schemas/ai/tools";

const tracer = trace.getTracer("@reef/core");

/**
 * suggest_labels — Returns label suggestions with rationale.
 *
 * No GitHub writes. Pure suggestion — caller (agent or UI) decides what to
 * apply. Returns structured suggestions that the PM can accept, reject, or
 * edit in the Draft Review UI.
 */
export const suggestLabelsTool = tool({
  description:
    "Suggest labels for a new issue based on its title, content, and optional repo context. " +
    "Returns an array of label suggestions with rationale. Does NOT write to GitHub.",
  inputSchema: SuggestLabelsInputSchema,
  execute: async (input): Promise<SuggestLabelsOutput> => {
    return tracer.startActiveSpan("reef.tool.suggest_labels", async (span) => {
      span.setAttribute("tool.input.title", input.title);
      try {
        // Structured suggestion: this execute body performs rule-based
        // fallback suggestions using keyword matching on title + content. The
        // LLM invokes this tool and can pre-populate input with rich context
        // from its chain-of-thought.
        const suggestions: SuggestLabelsOutput["suggestions"] = [];

        const combined = `${input.title} ${input.content}`.toLowerCase();

        if (/bug|fix|broken|error|crash|fail/.test(combined)) {
          suggestions.push({
            label: "bug",
            rationale: "Title/content indicates a defect or failure.",
          });
        }
        if (/feat|feature|add|new|implement|support/.test(combined)) {
          suggestions.push({
            label: "enhancement",
            rationale: "Title/content indicates a new capability.",
          });
        }
        if (/doc|docs|readme|spec|comment|description/.test(combined)) {
          suggestions.push({
            label: "documentation",
            rationale: "Title/content relates to documentation.",
          });
        }
        if (/refactor|cleanup|clean up|tidy|simplify/.test(combined)) {
          suggestions.push({
            label: "refactor",
            rationale:
              "Title/content suggests code improvement without new functionality.",
          });
        }
        if (/test|spec|coverage|vitest|playwright/.test(combined)) {
          suggestions.push({
            label: "testing",
            rationale: "Title/content relates to test coverage.",
          });
        }
        if (suggestions.length === 0) {
          suggestions.push({
            label: "needs-triage",
            rationale:
              "No specific label pattern detected — manual triage recommended.",
          });
        }

        const output: SuggestLabelsOutput = { suggestions };
        const parsed = SuggestLabelsOutputSchema.safeParse(output);
        if (!parsed.success) {
          throw new SchemaValidationError({
            field: "suggestLabelsOutput",
            issues: parsed.error.issues.map((i) => i.message),
          });
        }

        span.setAttribute("tool.output.suggestion_count", suggestions.length);
        span.setStatus({ code: SpanStatusCode.OK });
        return parsed.data;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        throw err;
      } finally {
        span.end();
      }
    });
  },
});
