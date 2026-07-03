"use client";

import { createContext, useContext } from "react";

/**
 * Carries the deployment's akb web base URL (REEF-368) from the server root
 * layout — which reads it at request time via `getAkbWebUrl()` — down to client
 * components that link out to akb (the linked-document card's "open" action).
 *
 * The value is deployment-managed server state, not per-user; it is a plain
 * serializable string (or null when unset), so the server layout can pass it
 * straight across the server→client boundary as the provider `value`.
 *
 * Default null so a consumer rendered outside the provider (e.g. an isolated
 * unit test or story) degrades to the same "no base configured" path as an
 * unset deployment — the open action hides and copy stays.
 */
const AkbWebUrlContext = createContext<string | null>(null);

export function AkbWebUrlProvider({
  value,
  children,
}: {
  value: string | null;
  children: React.ReactNode;
}) {
  return (
    <AkbWebUrlContext.Provider value={value}>
      {children}
    </AkbWebUrlContext.Provider>
  );
}

/** The runtime akb web base URL, or null when this deployment configured none. */
export function useAkbWebUrl(): string | null {
  return useContext(AkbWebUrlContext);
}
