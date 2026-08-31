import {
  type MyViewEnvelope,
  type MyViewSnapshot,
  buildMyViewEnvelope,
  canonicalizeMyViewName,
  normalizeMyViewEnvelope,
} from "@reef/core";
import { clearConfigByPrefix, getConfigValue, setConfigValue } from "./config";
import { type ConfigEntry, db } from "./db";

export const MY_VIEW_STORAGE_KEY_PREFIX = "my_view:";

export type MyView = MyViewEnvelope;

export class MyViewError extends Error {
  constructor(
    message: string,
    readonly code: "duplicate" | "not_found" | "invalid" | "storage",
  ) {
    super(message);
    this.name = "MyViewError";
  }
}

export class MyViewDuplicateError extends MyViewError {
  constructor() {
    super("A My View with this name already exists.", "duplicate");
    this.name = "MyViewDuplicateError";
  }
}

class MyViewNotFoundError extends MyViewError {
  constructor() {
    super("The My View no longer exists.", "not_found");
    this.name = "MyViewNotFoundError";
  }
}

class MyViewInvalidError extends MyViewError {
  constructor() {
    super("The My View is invalid.", "invalid");
    this.name = "MyViewInvalidError";
  }
}

function assertPart(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`My View ${label} is required`);
  }
  return value.trim();
}

function assertId(id: string): void {
  if (
    typeof id !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(id)
  ) {
    throw new TypeError("My View id is invalid");
  }
}

function encodeKeyPart(value: string): string {
  return encodeURIComponent(value);
}

export function myViewStorageKey(
  actor: string,
  vault: string,
  id: string,
): string {
  const normalizedActor = assertPart(actor, "owner");
  const normalizedVault = assertPart(vault, "vault");
  assertId(id);
  return `${MY_VIEW_STORAGE_KEY_PREFIX}${encodeKeyPart(normalizedActor)}:${encodeKeyPart(normalizedVault)}:${id}`;
}

function myViewScopePrefix(actor: string, vault: string): string {
  return `${MY_VIEW_STORAGE_KEY_PREFIX}${encodeKeyPart(assertPart(actor, "owner"))}:${encodeKeyPart(assertPart(vault, "vault"))}:`;
}

function parseEntry(
  entry: ConfigEntry,
  actor: string,
  vault: string,
): MyView | null {
  try {
    const raw = JSON.parse(entry.value) as unknown;
    const envelope = normalizeMyViewEnvelope(raw);
    if (
      !envelope ||
      envelope.owner !== actor.trim() ||
      envelope.vault !== vault.trim()
    ) {
      return null;
    }
    return envelope;
  } catch {
    return null;
  }
}

async function readEntry(
  actor: string,
  vault: string,
  id: string,
): Promise<{ entry: ConfigEntry; item: MyView }> {
  const key = myViewStorageKey(actor, vault, id);
  const entry = await db.config.where("key").equals(key).first();
  if (!entry) throw new MyViewNotFoundError();
  const item = parseEntry(entry, actor, vault);
  if (!item) throw new MyViewInvalidError();
  return { entry, item };
}

async function readBack(
  actor: string,
  vault: string,
  id: string,
): Promise<MyView> {
  const raw = await getConfigValue(myViewStorageKey(actor, vault, id));
  if (!raw) {
    throw new MyViewError("The My View could not be read back.", "storage");
  }
  try {
    const envelope = normalizeMyViewEnvelope(JSON.parse(raw) as unknown);
    if (
      !envelope ||
      envelope.owner !== actor.trim() ||
      envelope.vault !== vault.trim()
    ) {
      throw new MyViewError("The My View could not be read back.", "storage");
    }
    return envelope;
  } catch (error) {
    if (error instanceof MyViewError) throw error;
    throw new MyViewError("The My View could not be read back.", "storage");
  }
}

async function assertNameAvailable(
  actor: string,
  vault: string,
  name: string,
  excludedId?: string,
): Promise<void> {
  const nameKey = canonicalizeMyViewName(name);
  const items = await listMyViews(actor, vault);
  if (
    items.some((item) => item.id !== excludedId && item.nameKey === nameKey)
  ) {
    throw new MyViewDuplicateError();
  }
}

function newMyViewId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (!randomUUID) {
    throw new MyViewError(
      "The browser cannot create a stable My View id.",
      "storage",
    );
  }
  return randomUUID.call(globalThis.crypto);
}

export async function listMyViews(
  actor: string,
  vault: string,
): Promise<MyView[]> {
  const normalizedActor = assertPart(actor, "owner");
  const normalizedVault = assertPart(vault, "vault");
  const entries = await db.config
    .where("key")
    .startsWith(myViewScopePrefix(normalizedActor, normalizedVault))
    .toArray();
  return entries
    .map((entry) => parseEntry(entry, normalizedActor, normalizedVault))
    .filter((item): item is MyView => item !== null)
    .toSorted((left, right) =>
      left.nameKey === right.nameKey
        ? left.id.localeCompare(right.id)
        : left.nameKey.localeCompare(right.nameKey),
    );
}

export async function createMyView(input: {
  actor: string;
  vault: string;
  name: string;
  snapshot: MyViewSnapshot;
}): Promise<MyView> {
  const actor = assertPart(input.actor, "owner");
  const vault = assertPart(input.vault, "vault");
  await assertNameAvailable(actor, vault, input.name);
  const envelope = buildMyViewEnvelope({
    id: newMyViewId(),
    name: input.name,
    owner: actor,
    vault,
    snapshot: input.snapshot,
  });
  await setConfigValue(
    myViewStorageKey(actor, vault, envelope.id),
    JSON.stringify(envelope),
  );
  return readBack(actor, vault, envelope.id);
}

export async function updateMyView(input: {
  actor: string;
  vault: string;
  id: string;
  name?: string;
  snapshot?: MyViewSnapshot;
}): Promise<MyView> {
  const actor = assertPart(input.actor, "owner");
  const vault = assertPart(input.vault, "vault");
  const { item } = await readEntry(actor, vault, input.id);
  const name = input.name ?? item.name;
  if (name !== item.name) {
    await assertNameAvailable(actor, vault, name, input.id);
  }
  const envelope = buildMyViewEnvelope({
    id: item.id,
    name,
    owner: actor,
    vault,
    snapshot: input.snapshot ?? item.snapshot,
  });
  await setConfigValue(
    myViewStorageKey(actor, vault, envelope.id),
    JSON.stringify(envelope),
  );
  return readBack(actor, vault, envelope.id);
}

export async function deleteMyView(input: {
  actor: string;
  vault: string;
  id: string;
}): Promise<void> {
  const actor = assertPart(input.actor, "owner");
  const vault = assertPart(input.vault, "vault");
  assertId(input.id);
  const removed = await db.config
    .where("key")
    .equals(myViewStorageKey(actor, vault, input.id))
    .delete();
  if (removed === 0) throw new MyViewNotFoundError();
}

/** Clears all actor-scoped My Views during account reconciliation. */
export async function clearAllMyViews(): Promise<void> {
  await clearConfigByPrefix(MY_VIEW_STORAGE_KEY_PREFIX);
}
