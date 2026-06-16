/**
 * Next.js instrumentation hook — called once per runtime on server startup.
 *
 * Next.js invokes `register` in **all** server runtimes (Node.js + Edge), so
 * runtime-specific code should be gated behind `process.env.NEXT_RUNTIME` and
 * loaded via dynamic `import()` to keep Node dependencies (e.g.
 * `@opentelemetry/sdk-node`, `process.once`) out of the Edge bundle.
 *
 * See `node_modules/next/dist/docs/01-app/02-guides/instrumentation.md` —
 * "Importing runtime-specific code".
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNode } = await import("./instrumentation-node");
    registerNode();
  }
}
