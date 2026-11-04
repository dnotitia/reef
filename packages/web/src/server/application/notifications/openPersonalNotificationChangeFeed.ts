import {
  akbReadPersonalNotificationRevision,
  type AkbAdapter,
} from "@reef/core";
import { listActiveWorkspaces } from "@/server/application/workspaces/listActiveWorkspaces";

export const PERSONAL_NOTIFICATION_POLL_INTERVAL_MS = 3_000;
const REQUEST_TIMEOUT_MS = 10_000;

export interface PersonalNotificationChangeFeed {
  nextChange(): Promise<boolean>;
  close(): void;
}

function waitForPoll(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, PERSONAL_NOTIFICATION_POLL_INTERVAL_MS);
    signal.addEventListener("abort", finish, { once: true });
  });
}

/** Keep the browser feed account-scoped while AKB serves only short SQL reads. */
export async function openPersonalNotificationChangeFeed(params: {
  adapter: AkbAdapter;
  actor: string;
  signal?: AbortSignal;
}): Promise<PersonalNotificationChangeFeed> {
  const controller = new AbortController();
  const signal = params.signal
    ? AbortSignal.any([params.signal, controller.signal])
    : controller.signal;
  const adapter: AkbAdapter = {
    request: (path, init) =>
      params.adapter.request(path, {
        ...init,
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          ...(init?.signal ? [init.signal] : []),
        ]),
      }),
  };
  const readRevision = async () => {
    const workspaces = await listActiveWorkspaces({ adapter });
    signal.throwIfAborted();
    return akbReadPersonalNotificationRevision(adapter, {
      recipient: params.actor,
      workspaces,
    });
  };
  let revision = "[]";
  try {
    if (!signal.aborted) revision = await readRevision();
  } catch (error) {
    controller.abort();
    throw error;
  }

  return {
    close: () => controller.abort(),
    async nextChange() {
      try {
        while (!signal.aborted) {
          await waitForPoll(signal);
          if (signal.aborted) return false;
          const nextRevision = await readRevision();
          if (signal.aborted) return false;
          if (nextRevision !== revision) {
            revision = nextRevision;
            return true;
          }
        }
      } catch (error) {
        if (!signal.aborted) throw error;
      }
      return false;
    },
  };
}
