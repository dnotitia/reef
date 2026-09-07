export async function readJson(req) {
  const body = await readRawBody(req);
  if (body.length === 0) return {};
  const raw = body.toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

export async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function headerQuoted(value) {
  return String(value)
    .replace(/["\\\r\n]/g, "_")
    .replace(/[^\x20-\x7e]/g, "_");
}

export function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}
