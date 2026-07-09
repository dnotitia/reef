import { z } from "zod";

/**
 * The akb knowledge-graph relation type reef uses to model an issue → akb
 * document reference. `depends_on` / `related_to` are reserved for issue↔issue
 * relationships, so document references get their own `references` edge to keep
 * the issue-relation graph clean (REEF-083).
 */
export const ISSUE_REFERENCE_RELATION = "references" as const;

/**
 * One akb-native `references` edge from an issue's document to a target akb
 * document, normalized from `GET /api/v1/relations`. `title` is akb's
 * same-vault resolved name (`name` on the wire) — absent (null) for a
 * cross-vault endpoint, which reef does not creates because the link route's
 * same-vault guard rejects it. `resource_type` is the akb resource kind
 * ("doc" / "table" / "file"); reef  links documents.
 */
export const AkbDocumentReferenceSchema = z.object({
  uri: z.string().min(1),
  title: z.string().nullable().optional(),
  resource_type: z.string().optional(),
});

export type AkbDocumentReference = z.infer<typeof AkbDocumentReferenceSchema>;

/** Response body for the issue references GET route. */
export const IssueReferencesResponseSchema = z.object({
  references: z.array(AkbDocumentReferenceSchema),
});

/**
 * Matches an akb DOCUMENT URI in either form — bare `akb://V/doc/<path>` or the
 * location-aware `akb://V/coll/<dir>/doc/<name>`. Excludes table (`/table/`),
 * file (`/file/`), and collection URIs so just a document can be linked as a
 * reference. akb's search endpoint is generalized over all three resource kinds.
 */
export const AKB_DOCUMENT_URI_RE = /^akb:\/\/[^/]+\/(?:coll\/.+\/)?doc\/.+$/;

/** Resolve document titles for markdown links without exposing AKB to clients. */
export const ResolveDocumentTitlesRequestSchema = z.object({
  uris: z.array(z.string().regex(AKB_DOCUMENT_URI_RE)).min(1).max(50),
});

export const ResolveDocumentTitlesResponseSchema = z.object({
  documents: z.array(AkbDocumentReferenceSchema),
});

/**
 * Request body to add an issue → document reference. `target_uri` is the
 * canonical `akb://` document URI to link (taken verbatim from a search hit).
 * The akb backend enforces the same-vault rule; reef rejects anything that is
 * not a document URI at the boundary so a table/file hit does not be stored as a
 * linked document.
 */
export const AddIssueReferenceRequestSchema = z.object({
  target_uri: z
    .string()
    .min(1)
    .regex(AKB_DOCUMENT_URI_RE, "target_uri must be an akb document URI"),
});

/**
 * One hit in the document-reference picker — the akb search fields the UI needs
 * to render a candidate (type glyph + title + collection breadcrumb + match
 * snippet) and link it. The web search route projects `searchDocuments` hits
 * onto this shape so the client does not depends on the raw akb envelope.
 */
export const DocumentSearchHitSchema = z.object({
  uri: z.string().min(1),
  title: z.string().nullable().optional(),
  collection: z.string().nullable().optional(),
  doc_type: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  matched_section: z.string().nullable().optional(),
});

export type DocumentSearchHit = z.infer<typeof DocumentSearchHitSchema>;
