import { describe, expect, it } from "vitest";
import {
  attachmentFileTypeLabel,
  isDocumentAssetTarget,
  isAkbFileUri,
  issueDocumentAssetHref,
  issueAttachmentFileHref,
  resolveIssueAttachmentUrl,
} from "./attachmentUrls";

describe("attachmentUrls (REEF-349)", () => {
  it("recognizes AKB file URIs", () => {
    expect(isAkbFileUri("akb://reef-test/issues/file/file-1")).toBe(true);
    expect(isAkbFileUri("akb://reef-test/issues/doc/file-1")).toBe(false);
    expect(isAkbFileUri("https://example.com/file/file-1")).toBe(false);
  });

  it("recognizes stable document attachment targets", () => {
    const target = "/api/assets/00000000-0000-4000-8000-000000000001";
    expect(isDocumentAssetTarget(target)).toBe(true);
    expect(isDocumentAssetTarget(`${target}/extra`)).toBe(false);
    expect(
      issueDocumentAssetHref({ vault: "reef test", assetTarget: target }),
    ).toBe(
      "/api/assets/00000000-0000-4000-8000-000000000001?vault=reef%20test",
    );
  });

  it("derives a bounded display type from the Markdown filename label", () => {
    expect(attachmentFileTypeLabel("incident.log")).toBe("LOG");
    expect(attachmentFileTypeLabel("archive.tar.gz")).toBe("GZ");
    expect(attachmentFileTypeLabel("README")).toBe("FILE");
    expect(attachmentFileTypeLabel("capture.verylongextension")).toBe("FILE");
    expect(attachmentFileTypeLabel("capture.bad-ext")).toBe("FILE");
    expect(attachmentFileTypeLabel("capture.éxt")).toBe("FILE");
  });

  it("builds an issue-scoped file proxy URL", () => {
    expect(
      issueAttachmentFileHref({
        issueId: "REEF-001",
        vault: "reef test",
        fileUri: "akb://reef-test/issues/file/file-1",
      }),
    ).toBe(
      "/api/issues/REEF-001/attachments/file?vault=reef%20test&uri=akb%3A%2F%2Freef-test%2Fissues%2Ffile%2Ffile-1",
    );
  });

  it("resolves only AKB file URIs and leaves other URLs untouched", () => {
    expect(
      resolveIssueAttachmentUrl({
        issueId: "REEF-001",
        vault: "v",
        url: "akb://reef-test/issues/file/file-1",
      }),
    ).toBe(
      "/api/issues/REEF-001/attachments/file?vault=v&uri=akb%3A%2F%2Freef-test%2Fissues%2Ffile%2Ffile-1",
    );
    expect(
      resolveIssueAttachmentUrl({
        issueId: "REEF-001",
        vault: "v",
        url: "akb://reef-test/issues/file/file-1",
        key: "href",
      }),
    ).toBe(
      "/api/issues/REEF-001/attachments/file?vault=v&uri=akb%3A%2F%2Freef-test%2Fissues%2Ffile%2Ffile-1&download=1",
    );
    expect(
      resolveIssueAttachmentUrl({
        issueId: "REEF-001",
        vault: "v",
        url: "https://example.com/image.png",
      }),
    ).toBe("https://example.com/image.png");
    expect(
      resolveIssueAttachmentUrl({
        issueId: "REEF-001",
        vault: "reef test",
        url: "/api/assets/00000000-0000-4000-8000-000000000001",
      }),
    ).toBe(
      "/api/assets/00000000-0000-4000-8000-000000000001?vault=reef%20test",
    );
  });
});
