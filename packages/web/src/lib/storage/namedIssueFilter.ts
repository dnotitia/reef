import {
  type NamedIssueFilterEnvelope,
  buildNamedIssueFilterEnvelope,
  canonicalizeNamedIssueFilterName,
  hasNamedIssueFilterPayload,
  normalizeNamedIssueFilterEnvelope,
} from "@reef/core";
import { clearConfigByPrefix } from "./config";
import { type ConfigEntry, db } from "./db";

const NAMED_ISSUE_FILTER_KEY_PREFIX = "named_filter:";

export interface NamedIssueFilter extends NamedIssueFilterEnvelope {
  applicable: boolean;
}

export class NamedIssueFilterError extends Error {
  constructor(
    message: string,
    readonly code: "duplicate" | "not_found" | "invalid" | "storage",
  ) {
    super(message);
    this.name = "NamedIssueFilterError";
  }
}

export class NamedIssueFilterDuplicateError extends NamedIssueFilterError {
  constructor() {
    super("A named issue filter with this name already exists.", "duplicate");
    this.name = "NamedIssueFilterDuplicateError";
  }
}

class NamedIssueFilterNotFoundError extends NamedIssueFilterError {
  constructor() {
    super("The named issue filter no longer exists.", "not_found");
    this.name = "NamedIssueFilterNotFoundError";
  }
}

class NamedIssueFilterInvalidError extends NamedIssueFilterError {
  constructor() {
    super("The named issue filter is invalid.", "invalid");
    this.name = "NamedIssueFilterInvalidError";
  }
}

function assertVault(vault: string): void {
  if (typeof vault !== "string" || !vault.trim()) {
    throw new TypeError("named issue filter vault is required");
  }
}

function assertId(id: string): void {
  if (
    typeof id !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(id)
  ) {
    throw new TypeError("named issue filter id is invalid");
  }
}

export function namedIssueFilterStorageKey(vault: string, id: string): string {
  assertVault(vault);
  assertId(id);
  return `${NAMED_ISSUE_FILTER_KEY_PREFIX}${vault}:${id}`;
}

function namedIssueFilterVaultPrefix(vault: string): string {
  assertVault(vault);
  return `${NAMED_ISSUE_FILTER_KEY_PREFIX}${vault}:`;
}

function toItem(envelope: NamedIssueFilterEnvelope): NamedIssueFilter {
  return {
    ...envelope,
    applicable: hasNamedIssueFilterPayload(envelope.payload),
  };
}

function parseEntry(entry: ConfigEntry): NamedIssueFilter | null {
  try {
    const raw = JSON.parse(entry.value) as unknown;
    const envelope = normalizeNamedIssueFilterEnvelope(raw);
    return envelope ? toItem(envelope) : null;
  } catch {
    return null;
  }
}

async function readEntry(
  vault: string,
  id: string,
): Promise<{ entry: ConfigEntry; item: NamedIssueFilter }> {
  const key = namedIssueFilterStorageKey(vault, id);
  const entry = await db.config.where("key").equals(key).first();
  if (!entry) throw new NamedIssueFilterNotFoundError();
  const item = parseEntry(entry);
  if (!item) throw new NamedIssueFilterInvalidError();
  return { entry, item };
}

async function assertNameAvailable(
  vault: string,
  name: string,
  excludedId?: string,
): Promise<void> {
  const nameKey = canonicalizeNamedIssueFilterName(name);
  const items = await listNamedIssueFilters(vault);
  if (
    items.some((item) => item.id !== excludedId && item.nameKey === nameKey)
  ) {
    throw new NamedIssueFilterDuplicateError();
  }
}

function newNamedIssueFilterId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (!randomUUID) {
    throw new NamedIssueFilterError(
      "The browser cannot create a stable named filter id.",
      "storage",
    );
  }
  return randomUUID.call(globalThis.crypto);
}

export async function listNamedIssueFilters(
  vault: string,
): Promise<NamedIssueFilter[]> {
  const entries = await db.config
    .where("key")
    .startsWith(namedIssueFilterVaultPrefix(vault))
    .toArray();
  return entries
    .map(parseEntry)
    .filter((item): item is NamedIssueFilter => item !== null)
    .toSorted((left, right) =>
      left.nameKey === right.nameKey
        ? left.id.localeCompare(right.id)
        : left.nameKey.localeCompare(right.nameKey),
    );
}

export async function createNamedIssueFilter(input: {
  vault: string;
  name: string;
  payload: unknown;
}): Promise<NamedIssueFilter> {
  assertVault(input.vault);
  await assertNameAvailable(input.vault, input.name);
  const envelope = buildNamedIssueFilterEnvelope({
    id: newNamedIssueFilterId(),
    name: input.name,
    payload: input.payload,
  });
  await db.config.add({
    key: namedIssueFilterStorageKey(input.vault, envelope.id),
    value: JSON.stringify(envelope),
  });
  return toItem(envelope);
}

export async function updateNamedIssueFilter(input: {
  vault: string;
  id: string;
  name?: string;
  payload?: unknown;
}): Promise<NamedIssueFilter> {
  const { entry, item } = await readEntry(input.vault, input.id);
  const name = input.name ?? item.name;
  if (name !== item.name) {
    await assertNameAvailable(input.vault, name, input.id);
  }
  const envelope = buildNamedIssueFilterEnvelope({
    id: item.id,
    name,
    payload: input.payload ?? item.payload,
  });
  await db.config.put({
    id: entry.id,
    key: namedIssueFilterStorageKey(input.vault, envelope.id),
    value: JSON.stringify(envelope),
  });
  return toItem(envelope);
}

export async function deleteNamedIssueFilter(input: {
  vault: string;
  id: string;
}): Promise<void> {
  const key = namedIssueFilterStorageKey(input.vault, input.id);
  const entry = await db.config.where("key").equals(key).first();
  if (!entry) throw new NamedIssueFilterNotFoundError();
  await db.config.where("key").equals(key).delete();
}

/** Clears every named filter across vaults during account reconciliation. */
export async function clearAllNamedIssueFilters(): Promise<void> {
  await clearConfigByPrefix(NAMED_ISSUE_FILTER_KEY_PREFIX);
}
