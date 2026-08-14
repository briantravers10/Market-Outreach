/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@market-outreach/core", "@market-outreach/db"],
  eslint: { ignoreDuringBuilds: true },
  serverExternalPackages: ["better-sqlite3"],
  // config/*.json is read via fs at runtime with a dynamically-computed path
  // (see packages/core/src/config.ts), which Next's static output-file-tracing
  // can't detect on its own — declare it explicitly so it ships with the
  // deployed serverless functions. (The demo database itself is embedded
  // directly as a JS module — see packages/db/src/demoDbData.ts — since
  // tracing did not reliably include it as a raw file.)
  outputFileTracingIncludes: {
    "/**": ["../../config/*.json", "../../packages/db/src/schema.sql"],
  },
};

module.exports = nextConfig;
