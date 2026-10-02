import { describe, expect, it } from "vitest";
import { AkbFileUriSchema } from "./files";

describe("AkbFileUriSchema", () => {
  it.each([
    "akb://reef-test/file/file-1",
    "akb://reef-test/issues/file/file-1",
    "akb://reef-test/coll/evidence/file/file-1",
  ])("accepts canonical AKB file URI %s", (uri) => {
    expect(AkbFileUriSchema.parse(uri)).toBe(uri);
  });

  it.each(["https://files.test/file-1", "akb://reef-test/table/pipeline"])(
    "rejects non-file URI %s",
    (uri) => {
      expect(AkbFileUriSchema.safeParse(uri).success).toBe(false);
    },
  );
});
