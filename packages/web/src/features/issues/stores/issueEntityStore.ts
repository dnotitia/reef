"use client";

import type { IssueListItem } from "@reef/core";
import { Store, useStore } from "@tanstack/react-store";

/**
 * Normalized client entity store for issue list items (REEF-098).
 *
 * Why this exists, on top of TanStack Query: the issue list is fetched as an
 * `IssueListItem[]` per `['issues','list',vault,<query>]` cache, so the same
 * issue is duplicated across every filter/sort variant and across the board /
 * list / search views. Editing one field forced the whole list cache to be
 * invalidated and re-pulled (`SELECT *` over the vault — akb has no ETag), which
 * re-issued every issue identity and re-rendered every card. This store is the
 * single normalized render source for issue *content*: one entity per id, so an
 * edit touches exactly one entry and only the components subscribed to that id
 * re-render ("cost scales with what changed").
 *
 * The TanStack Query list cache is kept as the ordering / membership source and
 * for whole-set consumers (Reports aggregation, Timeline derivation); the store
 * is fed from those query results by the normalizer in `QueryProvider`, and by
 * the issue mutations directly. Query stays the server/data-state owner; this is
 * a derived, normalized read-through projection, not a second source of truth.
 *
 * Vault isolation is structural: entities live under `byVault[vault]`, so a
 * lookup can never cross workspaces. A vault switch or credential change purges
 * the relevant namespace (see `purgeVault` / `purgeAll`).
 */
export interface IssueEntityState {
  /** vault name → (issue id → list item). */
  byVault: Record<string, Record<string, IssueListItem>>;
}

export const issueEntityStore = new Store<IssueEntityState>({ byVault: {} });

/**
 * Merge a batch of list items (a fetched/filtered page, or a refetch) into a
 * vault's namespace. Reference-stable on purpose: an item whose object identity
 * is unchanged (TanStack Query's structural sharing preserves the refs of rows
 * that did not change across a refetch) is left in place, so a refetch that
 * returns identical data produces no new entity refs and therefore no
 * re-render. Only changed/new rows replace their entry.
 */
export function upsertIssues(
  vault: string,
  items: readonly IssueListItem[],
): void {
  if (items.length === 0) return;
  issueEntityStore.setState((state) => {
    const current = state.byVault[vault];
    let nextById: Record<string, IssueListItem> | null = null;
    for (const item of items) {
      if (current?.[item.id] === item) continue; // unchanged ref → skip
      if (nextById === null) nextById = { ...current };
      nextById[item.id] = item;
    }
    if (nextById === null) return state; // nothing changed → same state ref
    return { byVault: { ...state.byVault, [vault]: nextById } };
  });
}

/** Upsert a single entity (a mutation result or optimistic patch). */
export function upsertIssue(vault: string, item: IssueListItem): void {
  issueEntityStore.setState((state) => {
    const current = state.byVault[vault];
    if (current?.[item.id] === item) return state;
    return {
      byVault: {
        ...state.byVault,
        [vault]: { ...current, [item.id]: item },
      },
    };
  });
}

/** Drop a single entity (a delete). No-op when absent. */
export function removeIssue(vault: string, id: string): void {
  issueEntityStore.setState((state) => {
    const current = state.byVault[vault];
    if (!current || !(id in current)) return state;
    const { [id]: _removed, ...rest } = current;
    return { byVault: { ...state.byVault, [vault]: rest } };
  });
}

/** Purge one vault's namespace (a workspace switch leaving that vault). */
export function purgeVault(vault: string): void {
  issueEntityStore.setState((state) => {
    if (!(vault in state.byVault)) return state;
    const { [vault]: _dropped, ...rest } = state.byVault;
    return { byVault: rest };
  });
}

/** Purge every vault (a credential change / sign-out). */
export function purgeAll(): void {
  issueEntityStore.setState((state) =>
    Object.keys(state.byVault).length === 0 ? state : { byVault: {} },
  );
}

/**
 * Purge every vault except the one being switched to — the workspace-switch
 * purge path. Bounds store memory to the active workspace without dropping the
 * entries the next render needs (those are refetched + re-normalized anyway).
 */
export function purgeAllExcept(vault: string): void {
  issueEntityStore.setState((state) => {
    const keys = Object.keys(state.byVault);
    if (keys.length === 0 || (keys.length === 1 && keys[0] === vault)) {
      return state;
    }
    const keep = state.byVault[vault];
    return { byVault: keep ? { [vault]: keep } : {} };
  });
}

/** Imperative read (tests, non-React callers). */
export function getIssueEntity(
  vault: string,
  id: string,
): IssueListItem | undefined {
  return issueEntityStore.state.byVault[vault]?.[id];
}

/**
 * Subscribe a component to a single issue entity. Re-renders only when *this*
 * id's entity changes in *this* vault — the granular read source for cards and
 * rows. Returns `undefined` until the entity has been normalized into the store
 * (callers pass a seed item for the first paint).
 */
export function useIssueEntity(
  vault: string,
  id: string,
): IssueListItem | undefined {
  return useStore(issueEntityStore, (state) => state.byVault[vault]?.[id]);
}
