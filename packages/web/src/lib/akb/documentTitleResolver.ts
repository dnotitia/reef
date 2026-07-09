import { apiFetch, throwHttpError } from "@/lib/apiClient";
import type { AkbDocumentReference } from "@reef/core";

type TitleValue = string | null;

const resolvedTitleCache = new Map<string, TitleValue>();
const inFlightTitleRequests = new Map<string, Promise<TitleValue>>();

function cacheKey(vault: string, uri: string): string {
  return `${vault}:${uri}`;
}

function readCached(vault: string, uri: string): TitleValue | undefined {
  return resolvedTitleCache.get(cacheKey(vault, uri));
}

function writeCached(vault: string, uri: string, title: TitleValue): void {
  resolvedTitleCache.set(cacheKey(vault, uri), title);
}

export async function resolveAkbDocumentTitles(
  vault: string,
  uris: readonly string[],
): Promise<Map<string, TitleValue>> {
  const uniqueUris = [...new Set(uris)];
  const result = new Map<string, TitleValue>();
  const pendingUris: string[] = [];
  const pendingPromises: Array<Promise<void>> = [];

  for (const uri of uniqueUris) {
    const cached = readCached(vault, uri);
    if (cached !== undefined) {
      result.set(uri, cached);
      continue;
    }
    const key = cacheKey(vault, uri);
    const inFlight = inFlightTitleRequests.get(key);
    if (inFlight) {
      pendingPromises.push(
        inFlight.then((title) => {
          result.set(uri, title);
        }),
      );
      continue;
    }
    pendingUris.push(uri);
  }

  if (pendingUris.length > 0) {
    const batchPromise = apiFetch(
      `/api/documents/resolve?vault=${encodeURIComponent(vault)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uris: pendingUris }),
      },
    )
      .then(async (res) => {
        if (!res.ok) {
          await throwHttpError(res, "Failed to resolve document titles");
        }
        const body = (await res.json()) as {
          documents?: AkbDocumentReference[];
        };
        return new Map(
          (body.documents ?? []).map((document) => [
            document.uri,
            document.title ?? null,
          ]),
        );
      })
      .catch(() => new Map<string, TitleValue>());

    for (const uri of pendingUris) {
      const key = cacheKey(vault, uri);
      const titlePromise = batchPromise
        .then((titles) => titles.get(uri) ?? null)
        .then((title) => {
          writeCached(vault, uri, title);
          result.set(uri, title);
          return title;
        })
        .finally(() => {
          inFlightTitleRequests.delete(key);
        });
      inFlightTitleRequests.set(key, titlePromise);
      pendingPromises.push(titlePromise.then(() => undefined));
    }
  }

  await Promise.all(pendingPromises);
  return result;
}

export function clearAkbDocumentTitleCacheForTests(): void {
  resolvedTitleCache.clear();
  inFlightTitleRequests.clear();
}
