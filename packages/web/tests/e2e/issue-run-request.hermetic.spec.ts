import { expect, test } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
  setIssueRunCase,
  setVaultRole,
} from "./harness/fixture";

const issueUrl = `/workspace/${REEF_E2E_VAULT}/issues/REEF-001`;

test.describe("Hermetic issue run request", () => {
  test.beforeEach(async ({ context, request, page }) => {
    await context.clearCookies();
    await resetFixture(request, "issue_runs");
    await openExistingWorkspace(page);
  });

  test("queues through the real Route Handler and leaves issue status unchanged", async ({
    page,
    request,
  }) => {
    await page.goto(issueUrl);
    await expect(page.getByTestId("issue-run-trigger")).toHaveText("Run");
    await page.getByTestId("issue-run-trigger").click();
    await expect(page.getByTestId("issue-run-single-target")).toContainText(
      "octo/reef",
    );
    await page.getByTestId("request-issue-run").click();
    await expect(page.getByTestId("issue-run-trigger")).toHaveText("Queued");

    await expect
      .poll(async () => {
        const vault = (await readFixtureState(request)).vaults.find(
          (item) => item.name === REEF_E2E_VAULT,
        );
        return {
          runs: vault?.agent_runs.length,
          events: vault?.work_events.length,
          status: vault?.issues.find((issue) => issue.id === "REEF-001")
            ?.status,
        };
      })
      .toEqual({ runs: 1, events: 1, status: "todo" });
  });

  test("requires explicit repository selection when two targets are eligible", async ({
    page,
    request,
  }) => {
    await setIssueRunCase(request, { targetCount: 2 });
    await page.goto(issueUrl);
    await page.getByTestId("issue-run-trigger").click();
    await expect(page.getByTestId("request-issue-run")).toBeDisabled();
    await page.getByTestId("issue-run-target-select").click();
    await page.getByRole("option", { name: "octo/reef-mobile" }).click();
    await expect(page.getByTestId("request-issue-run")).toBeEnabled();
  });

  test("enforces reader and writer-assignee authorization while admin overrides", async ({
    page,
    request,
  }) => {
    await setVaultRole(request, "reader");
    let status = await page.evaluate(async (vault) => {
      const response = await fetch("/api/issues/REEF-001/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vault,
          github_id: 1001,
          request_id: crypto.randomUUID(),
        }),
      });
      return response.status;
    }, REEF_E2E_VAULT);
    expect(status).toBe(403);

    await setVaultRole(request, "writer");
    await setIssueRunCase(request, { assignedTo: "bob" });
    status = await page.evaluate(async (vault) => {
      const response = await fetch("/api/issues/REEF-001/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vault,
          github_id: 1001,
          request_id: crypto.randomUUID(),
        }),
      });
      return response.status;
    }, REEF_E2E_VAULT);
    expect(status).toBe(403);

    await setVaultRole(request, "admin");
    status = await page.evaluate(async (vault) => {
      const response = await fetch("/api/issues/REEF-001/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vault,
          github_id: 1001,
          request_id: crypto.randomUUID(),
        }),
      });
      return response.status;
    }, REEF_E2E_VAULT);
    expect(status).toBe(202);
  });

  test("fails closed for status, dependency, and document conditions without inspecting prose", async ({
    page,
    request,
  }) => {
    async function eligibility() {
      return page.evaluate(
        async (vault) =>
          fetch(
            `/api/issues/REEF-001/run-eligibility?vault=${encodeURIComponent(vault)}`,
          ).then((response) => response.json()),
        REEF_E2E_VAULT,
      );
    }

    await setIssueRunCase(request, { status: "backlog" });
    await expect
      .poll(async () => (await eligibility()).reasons)
      .toContain("issue_status_not_todo");
    await setIssueRunCase(request, {
      status: "todo",
      dependsOn: ["REEF-002"],
    });
    await expect
      .poll(async () => (await eligibility()).reasons)
      .toContain("unresolved_dependencies");
    await setIssueRunCase(request, {
      dependsOn: [],
      documentAvailable: false,
    });
    await expect
      .poll(async () => (await eligibility()).reasons)
      .toContain("issue_document_unavailable");

    for (const body of [
      "## Acceptance Criteria\nDone",
      "## 인수 조건\n완료",
      "Done when this works",
      "완료 조건은 정상 동작입니다.",
      "A plain prose description.",
    ]) {
      await setIssueRunCase(request, { documentAvailable: true, body });
      expect((await eligibility()).eligible).toBe(true);
    }
  });

  test("deduplicates simultaneous request ids with one active slot", async ({
    page,
    request,
  }) => {
    const statuses = await page.evaluate(async (vault) => {
      const send = (requestId: string) =>
        fetch("/api/issues/REEF-001/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vault,
            github_id: 1001,
            request_id: requestId,
          }),
        }).then((response) => response.status);
      return Promise.all([
        send(crypto.randomUUID()),
        send(crypto.randomUUID()),
      ]);
    }, REEF_E2E_VAULT);
    expect(statuses.toSorted()).toEqual([202, 409]);
    const vault = (await readFixtureState(request)).vaults.find(
      (item) => item.name === REEF_E2E_VAULT,
    );
    expect(vault?.agent_runs).toHaveLength(1);
    expect(vault?.work_events).toHaveLength(1);
    expect(vault?.issues.find((issue) => issue.id === "REEF-001")?.status).toBe(
      "todo",
    );
  });
});
