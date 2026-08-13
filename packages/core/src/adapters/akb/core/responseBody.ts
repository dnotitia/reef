export class AkbResponseDeadlineError extends Error {}
export class AkbResponseLimitError extends Error {}

export interface AkbJsonBodyPolicy {
  maxBytes: number;
  signal: AbortSignal;
}

export async function readAkbJsonBody(
  response: Response,
  policy?: AkbJsonBodyPolicy,
): Promise<unknown> {
  if (!policy) return response.json();

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > policy.maxBytes) {
    throw new AkbResponseLimitError();
  }
  const reader = response.body?.getReader();
  if (!reader) throw new SyntaxError("empty response");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await readWithDeadline(reader, policy.signal);
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > policy.maxBytes) throw new AkbResponseLimitError();
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body) as unknown;
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  }
}

function readWithDeadline(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) return Promise.reject(new AkbResponseDeadlineError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new AkbResponseDeadlineError());
    signal.addEventListener("abort", onAbort, { once: true });
    void reader
      .read()
      .then(resolve, reject)
      .finally(() => {
        signal.removeEventListener("abort", onAbort);
      });
  });
}
