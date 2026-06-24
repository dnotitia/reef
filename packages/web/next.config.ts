import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// next-intl, without i18n routing (ADR-0001). The plugin points the request
// config module that resolves the per-request locale + messages; locale lives in
// a cookie, not the URL, so no route segment or middleware rewrite is added.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  // Keep pino (and its dev-only pino-pretty transport) out of the server bundle.
  // pino loads its transport via a worker thread and `require`, which the
  // bundler cannot trace — externalizing them lets pino resolve them at runtime.
  // (REEF-235)
  serverExternalPackages: ["pino", "pino-pretty"],
  experimental: {
    // Transform barrel named imports into direct deep imports at build time so
    // the package index is never fully loaded. Recommended fix per the Vercel
    // bundle-size guideline. Next 16 already ships `lucide-react` (and date-fns,
    // recharts, …) in its defaults — kept here for intent/REEF-058 history; the
    // Set dedupes it. The additions below are the radix + dnd-kit barrels reef
    // actually imports, which are NOT in Next's default list. (REEF-097 AC3)
    optimizePackageImports: [
      "lucide-react",
      "@radix-ui/react-dialog",
      "@radix-ui/react-select",
      "@dnd-kit/core",
      "@dnd-kit/sortable",
    ],
  },
};

export default withNextIntl(nextConfig);
