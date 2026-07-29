import { apiFetch, throwHttpError } from "@/lib/apiClient";
import {
  type EffectiveSubscriptionState,
  EffectiveSubscriptionStateSchema,
} from "@reef/core";

export type IssueSubscriptionAction = "watch" | "mute";

function subscriptionUrl(issueId: string, vault: string): string {
  return `/api/issues/${encodeURIComponent(issueId)}/subscription?vault=${encodeURIComponent(vault)}`;
}

async function parseState(
  response: Response,
): Promise<EffectiveSubscriptionState> {
  const body = (await response.json()) as { state?: unknown };
  return EffectiveSubscriptionStateSchema.parse(body.state);
}

export async function fetchIssueSubscription(
  issueId: string,
  vault: string,
): Promise<EffectiveSubscriptionState> {
  const response = await apiFetch(subscriptionUrl(issueId, vault));
  if (!response.ok) {
    await throwHttpError(
      response,
      `Failed to fetch issue notification preference: ${response.status}`,
    );
  }
  return parseState(response);
}

export async function updateIssueSubscription({
  issueId,
  vault,
  action,
}: {
  issueId: string;
  vault: string;
  action: IssueSubscriptionAction;
}): Promise<EffectiveSubscriptionState> {
  const response = await apiFetch(subscriptionUrl(issueId, vault), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  if (!response.ok) {
    await throwHttpError(
      response,
      `Failed to update issue notification preference: ${response.status}`,
    );
  }
  return parseState(response);
}
