import { describe, expect, it } from "vitest";
import { convertAdfToMarkdown } from "../content/adf.js";
import type { NormalizedJiraAttachment } from "../payloads.js";
import type { JiraRelatedImportReport } from "./contracts.js";
import { resolveJiraMediaReference } from "./import.js";
import { rewriteMedia } from "./media.js";

describe("media crosswalk", () => {
  const source = (id: string, filename: string): NormalizedJiraAttachment => ({
    id,
    filename,
    mimeType: null,
    size: null,
    contentUrl: null,
    created: null,
    author: null,
  });
  it("uses deterministic strategies and refuses ambiguous filenames", () => {
    const media = {
      path: "$",
      mediaId: "m1",
      mediaType: "file",
      collection: null,
      filename: "a.bin",
      alt: null,
      rawArchiveReference: null,
      placeholder: "placeholder",
      legacyPlaceholder: "legacy-placeholder",
    };
    expect(
      resolveJiraMediaReference(
        media,
        [{ source: source("1", "a.bin"), fileUri: "akb://v/file/1" }],
        "",
      )?.strategy,
    ).toBe("unique_filename");
    expect(
      resolveJiraMediaReference(
        media,
        [
          { source: source("1", "a.bin"), fileUri: "akb://v/file/1" },
          { source: source("2", "a.bin"), fileUri: "akb://v/file/2" },
        ],
        "",
      ),
    ).toBeNull();
    const altOnlyMedia = convertAdfToMarkdown({
      type: "doc",
      version: 1,
      content: [
        {
          type: "media",
          attrs: { id: "m1", type: "file", alt: "a.bin" },
        },
      ],
    }).media[0];
    expect(altOnlyMedia?.filename).toBeNull();
    expect(altOnlyMedia?.alt).toBe("a.bin");
    expect(
      altOnlyMedia
        ? resolveJiraMediaReference(
            altOnlyMedia,
            [
              { source: source("1", "a.bin"), fileUri: "akb://v/file/1" },
              { source: source("2", "b.bin"), fileUri: "akb://v/file/2" },
            ],
            "",
          )?.strategy
        : null,
    ).toBe("unique_filename");
    expect(
      altOnlyMedia
        ? resolveJiraMediaReference(
            altOnlyMedia,
            [
              { source: source("1", "a.bin"), fileUri: "akb://v/file/1" },
              { source: source("2", "b.bin"), fileUri: "akb://v/file/2" },
            ],
            '<span data-media-services-id="m1" href="/attachment/2/b.bin"></span>',
          )
        : null,
    ).toBeNull();
    expect(
      resolveJiraMediaReference(
        { ...media, filename: null },
        [{ source: source("1", "only.bin"), fileUri: "akb://v/file/1" }],
        "",
      )?.strategy,
    ).toBe("sole_attachment");
    expect(
      resolveJiraMediaReference(
        { ...media, filename: null },
        [
          { source: source("1", "a.bin"), fileUri: "akb://v/file/1" },
          { source: source("2", "b.bin"), fileUri: "akb://v/file/2" },
        ],
        '<span data-media-services-id="m1" title="b.bin" href="/attachment/2/b.bin"></span>',
      )?.strategy,
    ).toBe("rendered_element");
    expect(
      resolveJiraMediaReference(
        { ...media, filename: null },
        [
          { source: source("1", "a.bin"), fileUri: "akb://v/file/1" },
          { source: source("2", "b.bin"), fileUri: "akb://v/file/2" },
        ],
        '<span data-media-services-id="m1" title="att1" href="/attachment/2/b.bin"></span>',
      )?.binding.source.id,
    ).toBe("2");
    expect(
      resolveJiraMediaReference(
        { ...media, filename: null },
        [
          { source: source("1", "a.bin"), fileUri: "akb://v/file/1" },
          { source: source("2", "b.bin"), fileUri: "akb://v/file/2" },
        ],
        '<a data-media-services-id="m1" data-attachment-name="b.bin" href="/rest/api/3/attachment/content/2"></a>',
      )?.binding.source.id,
    ).toBe("2");
    expect(
      resolveJiraMediaReference(
        { ...media, filename: null },
        [
          { source: source("1", "a.bin"), fileUri: "akb://v/file/1" },
          { source: source("2", "b.bin"), fileUri: "akb://v/file/2" },
        ],
        '<span data-media-services-id="m1" data-attachment-id="1" href="/attachment/2/b.bin"></span>',
      ),
    ).toBeNull();
    expect(
      resolveJiraMediaReference(
        {
          ...media,
          filename: null,
          alt: "BOOTSTRAP_SEQ.png",
          mediaId: "media-uuid",
        },
        [
          {
            source: source("13072", "BOOTSTRAP_SEQ (media-uuid).png"),
            fileUri: "akb://v/file/13072",
          },
          {
            source: source("13073", "other.png"),
            fileUri: "akb://v/file/13073",
          },
        ],
        '<img src="/rest/api/3/attachment/content/13072" alt="BOOTSTRAP_SEQ.png">',
      )?.strategy,
    ).toBe("rendered_element");
    expect(
      resolveJiraMediaReference(
        { ...media, filename: null },
        [
          { source: source("1", "a.bin"), fileUri: "akb://v/file/1" },
          { source: source("2", "b.bin"), fileUri: "akb://v/file/2" },
        ],
        '<span data-media-services-id="m1" data-filename="b.bin"></span>',
      )?.strategy,
    ).toBe("rendered_unique_filename");
    expect(
      resolveJiraMediaReference(
        { ...media, filename: null },
        [
          { source: source("1", "a.bin"), fileUri: "akb://v/file/1" },
          {
            source: source("2", "manual (m1).pdf"),
            fileUri: "akb://v/file/2",
          },
        ],
        "<p>See [^manual (m1).pdf]</p>",
      )?.strategy,
    ).toBe("rendered_unique_filename");
    expect(
      resolveJiraMediaReference(
        { ...media, mediaType: "link" },
        [{ source: source("1", "a.bin"), fileUri: "akb://v/file/1" }],
        "",
      ),
    ).toBeNull();
    expect(
      resolveJiraMediaReference(
        { ...media, filename: null },
        [
          { source: source("1", "a.bin"), fileUri: "akb://v/file/1" },
          { source: source("2", "b.bin"), fileUri: "akb://v/file/2" },
        ],
        '<span data-media-services-id="m1" href="/attachment/1/a.bin"></span><span data-media-services-id="m1" href="/attachment/2/b.bin"></span>',
      ),
    ).toBeNull();
    expect(
      resolveJiraMediaReference(
        { ...media, filename: null },
        [
          { source: source("1", "a.bin"), fileUri: "akb://v/file/1" },
          { source: source("2", "b.bin"), fileUri: "akb://v/file/2" },
        ],
        `${"<".repeat(100_000)}><span data-media-services-id="m1" href="/attachment/2/b.bin"></span>`,
      )?.binding.source.id,
    ).toBe("2");
    expect(
      resolveJiraMediaReference(
        { ...media, filename: null },
        [
          { source: source("1", "a.bin"), fileUri: "akb://v/file/1" },
          { source: source("2", "b.bin"), fileUri: "akb://v/file/2" },
        ],
        '<span data-media-services-id="m1" data-media-services-id="m2" href="/attachment/2/b.bin"></span>',
      ),
    ).toBeNull();
  });

  it("uses the ordered filenames in Jira attachment error markers", () => {
    const filenames = [
      "[선행기술분석] 이기종 임베딩 벡터 인덱스에서의 점진적 후보군 확장을 통한 복합 조건 검색 방법 및 시스템.pdf",
      "[발명제안서]이기종 임베딩 벡터 인덱스에서의 점진적 후보군 확장을 통한 복합 조건 검색 방법 및 시스템.pdf",
      "[발명제안서]그래프 기반 근사 최근접 이웃 탐색을 활용한 효율적인 벡터 검색 필터링 방법 및 시스템.pdf",
      "[선행기술분석]그래프 기반 근사 최근접 이웃 탐색을 활용한 효율적인 벡터 검색 필터링 방법 및 시스템.pdf",
    ];
    const bindings = filenames.map((filename, index) => ({
      source: source(String(index + 1), filename),
      fileUri: `akb://attachment/${index + 1}`,
    }));
    const adf = {
      type: "doc",
      version: 1,
      content: filenames.map((_, index) => ({
        type: "mediaSingle",
        content: [
          {
            type: "media",
            attrs: { id: `media-${index + 1}`, type: "file" },
          },
        ],
      })),
    };
    const renderedHtml = filenames
      .map((filename) => {
        const prefixEnd = filename.indexOf("]");
        const prefix = filename
          .slice(0, prefixEnd + 1)
          .replaceAll("[", "&#91;")
          .replaceAll("]", "&#93;");
        return `[^<span class="error">${prefix}</span>${filename.slice(prefixEnd + 1)}]`;
      })
      .join("\n");
    const report: JiraRelatedImportReport = {
      mode: "dry-run",
      deletions: 0,
      comments: {
        total: 0,
        roots: 0,
        replies: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        flat_fallback: 0,
      },
      attachments: { total: 0, created: 0, skipped: 0, bytes: 0 },
      media: {
        total: 0,
        rewritten: 0,
        unresolved: 0,
        description_updated: false,
        by_strategy: {},
      },
      links: {
        entries: 0,
        unique: 0,
        applied: 0,
        skipped: 0,
        unresolved: 0,
        externalized: 0,
        unmapped: 0,
      },
      remote_links: { total: 0, applied: 0, skipped: 0 },
      operations: [],
      failures: [],
    };

    const result = rewriteMedia(
      adf,
      bindings,
      renderedHtml,
      report,
      "17663",
      bindings.map((binding) => binding.source),
    );

    expect(result.resolved).toBe(true);
    expect(report.media).toMatchObject({
      total: 4,
      rewritten: 4,
      unresolved: 0,
    });
    expect(report.media.by_strategy).toEqual({ rendered_unique_filename: 4 });
    expect(result.markdown).toBe(
      "akb://attachment/1\n\nakb://attachment/2\n\nakb://attachment/3\n\nakb://attachment/4",
    );
  });
});
