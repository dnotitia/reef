import { createHash } from "node:crypto";
import {
  type JsonValue,
  RawArchiveError,
  type RawArchiveErrorCode,
} from "./model.js";

function fail(code: RawArchiveErrorCode): never {
  throw new RawArchiveError(code);
}

export const sha256 = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

const assertNoLoneSurrogates = (value: string): void => {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail("invalid_json_value");
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail("invalid_json_value");
    }
  }
};

const canonicalize = (value: unknown, ancestors: Set<object>): string => {
  if (value === null) return "null";
  if (typeof value === "string") {
    assertNoLoneSurrogates(value);
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("invalid_json_value");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") fail("invalid_json_value");
  if (ancestors.has(value)) fail("invalid_json_value");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => canonicalize(item, ancestors)).join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail("invalid_json_value");
    }
    const record = value as Record<string, unknown>;
    const pairs = Object.keys(record)
      .sort()
      .map((key) => {
        assertNoLoneSurrogates(key);
        return `${JSON.stringify(key)}:${canonicalize(record[key], ancestors)}`;
      });
    return `{${pairs.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
};

/** RFC 8785/JCS serialization for I-JSON values. */
export const canonicalizeJson = (value: unknown): string =>
  canonicalize(value, new Set());

export const sha256CanonicalJson = (value: unknown): string =>
  sha256(canonicalizeJson(value));
