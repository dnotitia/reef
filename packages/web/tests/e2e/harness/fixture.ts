import { type APIRequestContext, type Page, expect } from "@playwright/test";

export const E2E_MOCK_URL =
  process.env.REEF_E2E_MOCK_URL ?? "http://127.0.0.1:7354";

export type FixtureScenario =
  | "empty"
  | "configured"
  | "raw_only"
  | "activity_suggestions"
  | "skill_outdated";
export const REEF_E2E_VAULT = "reef-e2e";

export async function resetFixture(
  request: APIRequestContext,
  scenario: FixtureScenario,
): Promise<void> {
  const response = await request.post(`${E2E_MOCK_URL}/__e2e/reset`, {
    data: { scenario },
  });
  expect(response.ok()).toBeTruthy();
}

export async function readFixtureState(request: APIRequestContext): Promise<{
  scenario: string;
  calls: Array<{ method: string; path: string }>;
  vaults: Array<{
    name: string;
    tables: string[];
    settings: Record<string, unknown>;
    monitored_repos: Array<{
      github_id: number;
      owner: string;
      name: string;
      description?: string;
    }>;
    issue_ids: string[];
    issues: Array<{
      id: string;
      title: string;
      status: string;
      priority: string | null;
      assigned_to: string | null;
      labels: string[];
    }>;
    sprints: Array<{ id: string; name: string; status: string }>;
    milestones: Array<{ id: string; name: string; status: string }>;
    releases: Array<{ id: string; name: string; status: string }>;
    templates: Array<{ name: string; label: string }>;
    activity_suggestions: Array<{
      id: string;
      kind: string;
      status: string;
      title: string | null;
      issue_id: string | null;
      reviewed_at: string | null;
      approved_issue_id?: string;
      proposal?: unknown;
    }>;
    documents: Array<{
      path: string;
      title: string;
      type: string;
      summary: string | null;
      content: string;
      tags: string[];
      current_commit: string;
    }>;
  }>;
}> {
  const response = await request.get(`${E2E_MOCK_URL}/__e2e/state`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Awaited<
    ReturnType<typeof readFixtureState>
  >;
}

export async function setIssueListFailure(
  request: APIRequestContext,
  enabled: boolean,
): Promise<void> {
  const response = await request.post(
    `${E2E_MOCK_URL}/__e2e/issue-list-failure`,
    { data: { enabled } },
  );
  expect(response.ok()).toBeTruthy();
}

export async function signInAsAlice(page: Page): Promise<void> {
  await page.goto("/login");
  await waitForPasswordLogin(page);
  await page.locator('[data-testid="login-username"]').fill("alice");
  await page.locator('[data-testid="login-password"]').fill("password");
  await page.locator('[data-testid="login-submit"]').click();
}

export async function signInAndSelectExistingWorkspace(
  page: Page,
  vault = REEF_E2E_VAULT,
): Promise<void> {
  await signInAsAlice(page);
  await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });

  await page.getByText("Use an existing reef workspace").click();
  await page.locator('[data-testid="active-vault-trigger"]').click();
  await expect(
    page.locator(`[data-testid="active-vault-option-${vault}"]`),
  ).toBeVisible();
  await expect(
    page.locator('[data-testid="active-vault-option-raw-vault"]'),
  ).toHaveCount(0);
  await page.locator(`[data-testid="active-vault-option-${vault}"]`).click();

  await expect(
    page.locator('[data-testid="onboarding-continue-btn"]'),
  ).toBeEnabled();
}

export async function continueToWorkspace(page: Page): Promise<void> {
  await page.locator('[data-testid="onboarding-continue-btn"]').click();
  await page.waitForURL(/\/issues\/?$/, { timeout: 10_000 });
}

export async function openExistingWorkspace(
  page: Page,
  vault = REEF_E2E_VAULT,
): Promise<void> {
  await signInAndSelectExistingWorkspace(page, vault);
  await continueToWorkspace(page);
}

export async function waitForPasswordLogin(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="akb-login-form"]')).toBeVisible();
  await expect(page.locator('[data-testid="sso-config-loading"]')).toHaveCount(
    0,
  );
}

export async function readIndexedDbConfig(
  page: Page,
  key: string,
): Promise<string | undefined> {
  return page.evaluate(async (configKey) => {
    const open = indexedDB.open("reef");
    return new Promise<string | undefined>((resolve, reject) => {
      open.onsuccess = () => {
        const db = open.result;
        try {
          const tx = db.transaction("config", "readonly");
          const store = tx.objectStore("config");
          const idx = store.index("key");
          const lookup = idx.get(configKey);
          lookup.onsuccess = () => {
            const value = lookup.result?.value;
            db.close();
            resolve(typeof value === "string" ? value : undefined);
          };
          lookup.onerror = () => {
            db.close();
            reject(lookup.error);
          };
        } catch (err) {
          db.close();
          reject(err);
        }
      };
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error("IndexedDB open blocked"));
    });
  }, key);
}

export async function readIndexedDbCredential(
  page: Page,
  key: string,
): Promise<string | undefined> {
  return page.evaluate(async (credentialKey) => {
    const open = indexedDB.open("reef");
    return new Promise<string | undefined>((resolve, reject) => {
      open.onsuccess = () => {
        const db = open.result;
        try {
          const tx = db.transaction("credentials", "readonly");
          const store = tx.objectStore("credentials");
          const idx = store.index("key");
          const lookup = idx.get(credentialKey);
          lookup.onsuccess = () => {
            const value = lookup.result?.value;
            db.close();
            resolve(typeof value === "string" ? value : undefined);
          };
          lookup.onerror = () => {
            db.close();
            reject(lookup.error);
          };
        } catch (err) {
          db.close();
          reject(err);
        }
      };
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error("IndexedDB open blocked"));
    });
  }, key);
}

export async function clearPersistedQueryCache(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.localStorage.removeItem("REACT_QUERY_OFFLINE_CACHE");
  });
}

/**
 * Drop the persisted React Query snapshot at document-start on every navigation
 * of `page`, before `QueryProvider` rehydrates it. Unlike `clearPersistedQueryCache`
 * (which clears once on an already-loaded page), this guarantees a fresh entry
 * starts with no cached queries even if another open page's async/throttled
 * persister re-writes the snapshot between the clear and the new page booting.
 * Use it for "bare entry must hit the server" assertions so they cannot flake on
 * a cache hit. The saved view filter lives in IndexedDB, not this localStorage
 * key, so it still restores. (REEF-220)
 */
export async function clearPersistedQueryCacheOnLoad(
  page: Page,
): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.removeItem("REACT_QUERY_OFFLINE_CACHE");
    } catch {
      // localStorage can be unavailable before navigation; the app re-clears
      // are not needed — a missing key is the desired state anyway.
    }
  });
}
