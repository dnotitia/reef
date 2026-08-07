import { type APIRequestContext, type Page, expect } from "@playwright/test";
import fixtureLogin from "./fixture-login.json";

export const E2E_MOCK_URL =
  process.env.REEF_E2E_MOCK_URL ?? "http://127.0.0.1:7354";

export type FixtureScenario =
  | "empty"
  | "configured"
  | "configured_empty"
  | "configured_caught_up"
  | "content_search"
  | "configured_multi"
  | "backlog_bulk_partial_failure"
  | "demo_board"
  | "raw_only"
  | "activity_suggestions"
  | "notifications"
  | "skill_outdated"
  | "comment_mentions"
  | "large_vault";
export const REEF_E2E_VAULT = "reef-e2e";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
      rank: number | null;
      parent_id: string | null;
      sprint_id: string | null;
      milestone_id: string | null;
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
    activity: Array<{
      reef_id: string;
      event_type: string;
      payload: unknown;
    }>;
    subscriptions: Array<{
      reef_id: string;
      subscriber: string;
      source: string;
      status: string;
    }>;
    notifications: Array<{
      id: string;
      notification_key: string;
      recipient: string;
      reef_id: string;
      source_type: string;
      source_ref: string;
      event_type: string;
      actor: string;
      occurred_at: string;
      state: string;
      read_at: string | null;
      archived_at: string | null;
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
  nextPageFailures = 0,
): Promise<void> {
  const response = await request.post(
    `${E2E_MOCK_URL}/__e2e/issue-list-failure`,
    { data: { enabled, next_page_failures: nextPageFailures } },
  );
  expect(response.ok()).toBeTruthy();
}

export async function setContentSearchMode(
  request: APIRequestContext,
  mode: "healthy" | "degraded" | "error" | "missing-comments",
  delayMs = 0,
): Promise<void> {
  const response = await request.post(
    `${E2E_MOCK_URL}/__e2e/content-search-control`,
    { data: { mode, delay_ms: delayMs } },
  );
  expect(response.ok()).toBeTruthy();
}

export async function setVaultListControl(
  request: APIRequestContext,
  control: { delayMs?: number; failures?: number },
): Promise<void> {
  const response = await request.post(
    `${E2E_MOCK_URL}/__e2e/vault-list-control`,
    {
      data: {
        delay_ms: control.delayMs ?? 0,
        failures: control.failures ?? 0,
      },
    },
  );
  expect(response.ok()).toBeTruthy();
}

export async function removeFixtureIssue(
  request: APIRequestContext,
  id: string,
  vault = REEF_E2E_VAULT,
): Promise<void> {
  const response = await request.post(`${E2E_MOCK_URL}/__e2e/remove-issue`, {
    data: { id, vault },
  });
  expect(response.ok()).toBeTruthy();
}

export async function setKeycloakEnabled(
  request: APIRequestContext,
  enabled: boolean,
): Promise<void> {
  const response = await request.post(`${E2E_MOCK_URL}/__e2e/keycloak`, {
    data: { enabled },
  });
  expect(response.ok()).toBeTruthy();
}

export async function setAuthPolicy(
  request: APIRequestContext,
  policy: {
    keycloakEnabled: boolean;
    localAuthEnabled: boolean;
    ssoOnly: boolean;
  },
): Promise<void> {
  const response = await request.post(`${E2E_MOCK_URL}/__e2e/keycloak`, {
    data: {
      enabled: policy.keycloakEnabled,
      local_auth_enabled: policy.localAuthEnabled,
      sso_only: policy.ssoOnly,
    },
  });
  expect(response.ok()).toBeTruthy();
}

export async function setAkbAccountDenial(
  request: APIRequestContext,
  code:
    | "membership_required"
    | "account_suspended"
    | "identity_conflict"
    | null,
): Promise<void> {
  const response = await request.post(`${E2E_MOCK_URL}/__e2e/account-denial`, {
    data: { code },
  });
  expect(response.ok()).toBeTruthy();
}

export async function signInAsAlice(page: Page): Promise<void> {
  await page.goto("/login?redirect=%2Fonboarding");
  await waitForPasswordLogin(page);
  await page
    .locator('[data-testid="login-username"]')
    .fill(fixtureLogin.username);
  await page
    .locator('[data-testid="login-password"]')
    .fill(fixtureLogin.password);
  const loginResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/auth/akb/login" &&
      response.request().method() === "POST",
  );
  await page.locator('[data-testid="login-submit"]').click();
  const loginResponse = await loginResponsePromise;
  expect(
    loginResponse.ok(),
    `POST /api/auth/akb/login failed with ${loginResponse.status()}`,
  ).toBeTruthy();

  // Wait until LoginForm has finished account reconciliation and committed its
  // post-login navigation. Generic fixture setup must not depend on the root
  // page's subsequent client redirect: when that redirect stalls, every test in
  // a shard spends all retries waiting for /onboarding even though login and
  // the session cookie succeeded. Root routing has dedicated coverage.
  await page.waitForURL((url) => url.pathname !== "/login", {
    timeout: 10_000,
  });
  await page.goto("/onboarding");
}

export async function signInAndSelectExistingWorkspace(
  page: Page,
  vault = REEF_E2E_VAULT,
): Promise<void> {
  await signInAsAlice(page);
  await expect(page).toHaveURL(
    new RegExp(`/workspace/${escapeRegExp(vault)}/issues/?$`),
    { timeout: 15_000 },
  );
}

export async function continueToWorkspace(
  page: Page,
  vault = REEF_E2E_VAULT,
): Promise<void> {
  await expect(page).toHaveURL(
    new RegExp(`/workspace/${escapeRegExp(vault)}/issues/?$`),
    { timeout: 15_000 },
  );

  // The auto-resume redirect can settle before DashboardShell's client effects
  // install the global shortcut listener. Prove the shell is interactive so a
  // caller's first shortcut is not lost in that hydration window.
  const globalSearchInput = page.locator('[data-testid="global-search-input"]');
  await expect(async () => {
    await page.keyboard.press("Control+K");
    await expect(globalSearchInput).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(globalSearchInput).toHaveCount(0);
}

export async function openExistingWorkspace(
  page: Page,
  vault = REEF_E2E_VAULT,
): Promise<void> {
  await signInAndSelectExistingWorkspace(page, vault);
  await continueToWorkspace(page, vault);
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

export async function writeIndexedDbConfig(
  page: Page,
  key: string,
  value: string,
): Promise<void> {
  await page.evaluate(
    async ({ configKey, configValue }) => {
      const open = indexedDB.open("reef");
      return new Promise<void>((resolve, reject) => {
        open.onsuccess = () => {
          const db = open.result;
          try {
            const tx = db.transaction("config", "readwrite");
            const store = tx.objectStore("config");
            const idx = store.index("key");
            const lookup = idx.get(configKey);
            lookup.onsuccess = () => {
              const existing = lookup.result as
                | { id?: number; key: string; value: string }
                | undefined;
              if (existing?.id !== undefined) {
                store.put({
                  id: existing.id,
                  key: configKey,
                  value: configValue,
                });
              } else {
                store.add({ key: configKey, value: configValue });
              }
            };
            lookup.onerror = () => reject(lookup.error);
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => {
              db.close();
              reject(tx.error);
            };
          } catch (err) {
            db.close();
            reject(err);
          }
        };
        open.onerror = () => reject(open.error);
        open.onblocked = () => reject(new Error("IndexedDB open blocked"));
      });
    },
    { configKey: key, configValue: value },
  );
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
