import { expect, test } from "@playwright/test";
import {
  E2E_MOCK_URL,
  readFixtureState,
  resetFixture,
} from "../harness/fixture";
import fixtureLogin from "../harness/fixture-login.json";

test.describe("Hermetic runtime discovery", () => {
  test("publishes runtime controls and resets named-filter fixtures idempotently", async ({
    request,
  }) => {
    const response = await request.get(`${E2E_MOCK_URL}/__e2e/runtime`);
    expect(response.ok()).toBeTruthy();
    const contract = await response.json();

    expect(contract).toMatchObject({
      schema_version: 1,
      status: "ready",
      operations: {
        health: { method: "GET", path: "/__e2e/health" },
        reset: {
          method: "POST",
          path: "/__e2e/reset",
          content_type: "application/json",
          body: { scenario: "<supported_scenario>" },
        },
      },
      fixture_login: {
        ...fixtureLogin,
      },
      tasks: {
        named_issue_filters: {
          scenario: "configured_multi",
          workspace: "reef-e2e",
          secondary_workspace: "reef-zeta",
          start_path: "/workspace/reef-e2e/issues?view=list",
        },
        content_search: {
          scenario: "content_search",
          workspace: "reef-e2e",
          start_path: "/workspace/reef-e2e/issues",
          interaction: {
            type: "global_search",
            shortcut: "Mod+K",
            platform_shortcuts: {
              macos: "Meta+K",
              other: "Control+K",
            },
            query: "issue title, body, or comment phrase",
          },
        },
        activity_suggestions: {
          scenario: "activity_suggestions",
          workspace: "reef-e2e",
          start_path: "/workspace/reef-e2e/suggestions",
          interaction: {
            type: "activity_review",
            operation:
              "review a pending suggestion, approve it, inspect the created issue, and add a comment",
          },
        },
        chat: {
          scenario: "configured",
          workspace: "reef-e2e",
          start_path: "/workspace/reef-e2e/issues",
          interaction: {
            type: "workspace_chat",
            operation:
              "open Ask AI, submit distinct questions, and observe each assistant response",
          },
        },
        comments: {
          scenario: "comment_mentions",
          workspace: "reef-e2e",
          start_path: "/workspace/reef-e2e/issues",
          interaction: {
            type: "issue_activity",
            operation:
              "open an issue, add a comment, and observe it in the activity timeline",
          },
        },
      },
    });
    const discoveredLogin = contract.fixture_login as typeof fixtureLogin;
    const { username, password } = discoveredLogin;
    const loginResponse = await request.post(
      `${E2E_MOCK_URL}/akb/api/v1/auth/login`,
      {
        data: {
          username,
          password,
        },
      },
    );
    expect(loginResponse.ok()).toBeTruthy();
    expect((await loginResponse.json()).user.username).toBe(username);
    expect(contract.scenarios).toEqual(
      expect.arrayContaining([
        "configured_multi",
        "content_search",
        "large_vault",
      ]),
    );

    await resetFixture(request, "configured_multi");
    const first = await readFixtureState(request);
    await resetFixture(request, "configured_multi");
    const second = await readFixtureState(request);
    const summarize = (state: Awaited<ReturnType<typeof readFixtureState>>) =>
      state.vaults.map((vault) => ({
        name: vault.name,
        issue_ids: vault.issue_ids,
      }));

    expect(first.scenario).toBe("configured_multi");
    expect(summarize(second)).toEqual(summarize(first));
    expect(first.vaults.map((vault) => vault.name)).toEqual(
      expect.arrayContaining(["reef-e2e", "reef-zeta"]),
    );
  });
});
