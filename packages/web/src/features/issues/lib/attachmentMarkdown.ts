export interface AttachmentMarkdownUploadResult {
  markdown: string | null;
}

export function filesFromFileList(fileList: FileList | null): File[] {
  if (!fileList) return [];
  return Array.from(fileList).filter((file) => file.size > 0);
}

export function appendMarkdownSnippets(
  current: string,
  snippets: readonly string[],
): string {
  const usefulSnippets = snippets
    .map((snippet) => snippet.trim())
    .filter(Boolean);
  if (usefulSnippets.length === 0) return current;
  const separator = current.trim().length > 0 ? "\n\n" : "";
  return `${current}${separator}${usefulSnippets.join("\n\n")}`;
}
