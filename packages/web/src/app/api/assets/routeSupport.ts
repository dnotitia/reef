const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const IMAGE_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function imageMimeType(request: Request): string | null {
  const value = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  return value && IMAGE_MIME_TYPES.has(value) ? value : null;
}

export function imageFilename(request: Request): string | null {
  const value = new URL(request.url).searchParams.get("filename")?.trim();
  return value && value.length <= 255 ? value : null;
}

function contentLength(request: Request): number | null {
  const value = request.headers.get("content-length");
  if (!value || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export async function readBoundedImageBody(
  request: Request,
): Promise<Uint8Array | "invalid" | "too_large"> {
  const declaredLength = contentLength(request);
  if (declaredLength !== null && declaredLength > MAX_IMAGE_BYTES) {
    return "too_large";
  }
  if (!request.body) return "invalid";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel();
      return "too_large";
    }
    chunks.push(next.value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.length > 0 ? body : "invalid";
}
