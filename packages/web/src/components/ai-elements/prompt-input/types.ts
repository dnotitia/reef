// Local prompt-input shapes that match the AI SDK 6 UIMessage parts this
// component consumes. Keep them here so the ai-elements primitives depend just
// on the fields they render.
export type ChatStatus = "submitted" | "streaming" | "ready" | "error";

export type FileUIPart = {
  type: "file";
  url: string;
  filename?: string;
  mediaType?: string;
};

export type SourceDocumentUIPart = {
  type: "source-document";
  sourceId: string;
  title?: string;
  filename?: string;
  mediaType?: string;
};
