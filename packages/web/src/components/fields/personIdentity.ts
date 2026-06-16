/**
 * personIdentity — framework-agnostic helpers behind PersonAvatar / PersonChip
 * (REEF-093). No React, no Tailwind: the monogram glyph and a stable hash,
 * memoized per identity key. The key is the login string, the one identifier
 * present on every surface (board, list, picker), so color and glyph stay
 * consistent for a person everywhere. Tailwind color classes live in fieldKit.
 */

// Hoisted once: a per-render RegExp literal would recompile on every avatar.
// Matches a leading CJK / Hangul glyph, which reads better as a single initial
// than a clipped Latin-style pair.
const LEADING_CJK = /[　-鿿가-힯]/;

/** First letters for the monogram: one glyph for CJK, two for Latin. */
export function computeInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  if (LEADING_CJK.test(trimmed[0])) return trimmed[0];
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
}

/** FNV-1a 32-bit — deterministic across runs, well-spread for short logins. */
export function hashKey(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export interface ResolvedIdentity {
  /** Monogram glyph, derived from the same key as the color. */
  initials: string;
  /** Raw hash; the leaf maps it into the avatar tone ramp. */
  hash: number;
}

// The same assignee appears across many rows; resolving once per key keeps the
// initials/hash work off the hot render path for lists and boards.
const identityCache = new Map<string, ResolvedIdentity>();

/** Resolve (and memoize) the monogram + hash for an identity key. */
export function resolveIdentity(key: string): ResolvedIdentity {
  const cached = identityCache.get(key);
  if (cached) return cached;
  const resolved: ResolvedIdentity = {
    initials: computeInitials(key),
    hash: hashKey(key),
  };
  identityCache.set(key, resolved);
  return resolved;
}
