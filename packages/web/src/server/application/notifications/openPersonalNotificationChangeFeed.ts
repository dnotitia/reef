import {
  CHANGE_EVENT_KIND,
  ChangeEventEnvelopeV1Schema,
  REEF_NOTIFICATIONS_TABLE,
  TableRowsChangedOperationSchema,
  createAkbChangeEventTail,
  tableResourceUri,
  type AkbChangeEventTail,
  type AkbStreamAdapter,
  type ChangeEventTailRecord,
} from "@reef/core";
import { listActiveWorkspaces } from "@/server/application/workspaces/listActiveWorkspaces";

interface FeedSource {
  vault: string;
  opened: boolean;
  iterator: AsyncGenerator<ChangeEventTailRecord>;
  next: Promise<IteratorResult<ChangeEventTailRecord>> | null;
}

export interface PersonalNotificationChangeFeed {
  nextChange(): Promise<boolean>;
  close(): void;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function isNotificationTableChange(
  record: ChangeEventTailRecord,
  vault: string,
): boolean {
  if (record.type !== "change") return false;
  const parsed = ChangeEventEnvelopeV1Schema.safeParse(record.event);
  if (!parsed.success) return false;
  const event = parsed.data;
  return (
    event.vault === vault &&
    event.kind === CHANGE_EVENT_KIND &&
    event.resource_uri === tableResourceUri(vault, REEF_NOTIFICATIONS_TABLE) &&
    TableRowsChangedOperationSchema.safeParse(event.payload.operation).success
  );
}

/** Open one authenticated AKB tail for every active source in the actor's account scope. */
export async function openPersonalNotificationChangeFeed(params: {
  adapter: AkbStreamAdapter;
  signal?: AbortSignal;
}): Promise<PersonalNotificationChangeFeed> {
  const vaults = await listActiveWorkspaces({ adapter: params.adapter });
  const abortController = new AbortController();
  const openedGate = deferred<void>();
  const closedGate = deferred<void>();
  const sources: FeedSource[] = [];
  let openedCount = 0;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    abortController.abort();
    closedGate.resolve();
  };

  const abortFromRequest = () => close();
  if (params.signal?.aborted) close();
  else
    params.signal?.addEventListener("abort", abortFromRequest, { once: true });

  const tail: AkbChangeEventTail = createAkbChangeEventTail(params.adapter);
  for (const vault of vaults) {
    const source: FeedSource = {
      vault,
      opened: false,
      iterator: tail.subscribe({
        vault,
        signal: abortController.signal,
        onOpen: () => {
          source.opened = true;
          openedCount += 1;
          if (openedCount === vaults.length) openedGate.resolve();
        },
      }),
      next: null,
    };
    sources.push(source);
  }

  const arm = (source: FeedSource) => {
    source.next = source.iterator.next();
    void source.next.then(
      (result) => {
        if (!source.opened && result.done) {
          openedGate.reject(
            new Error("AKB notification stream closed before opening"),
          );
        }
      },
      (error: unknown) => {
        if (!source.opened) openedGate.reject(error);
      },
    );
  };

  for (const source of sources) arm(source);
  if (vaults.length === 0) openedGate.resolve();

  try {
    await openedGate.promise;
  } catch (error) {
    close();
    throw error;
  }

  return {
    close: () => {
      params.signal?.removeEventListener("abort", abortFromRequest);
      close();
    },
    async nextChange() {
      if (closed) return false;
      if (sources.length === 0) {
        await closedGate.promise;
        return false;
      }

      while (!closed) {
        const pendingSources: Array<{
          source: FeedSource;
          next: Promise<IteratorResult<ChangeEventTailRecord>>;
        }> = [];
        for (const source of sources) {
          if (source.next) pendingSources.push({ source, next: source.next });
        }
        if (pendingSources.length === 0) return false;
        const settled = await Promise.race(
          pendingSources.map(async ({ source, next }) => ({
            source,
            result: await next,
          })),
        );
        settled.source.next = null;
        if (settled.result.done) {
          close();
          return false;
        }

        const isChange = isNotificationTableChange(
          settled.result.value,
          settled.source.vault,
        );
        arm(settled.source);
        if (isChange) return true;
      }
      return false;
    },
  };
}
