/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@market-outreach/core", "@market-outreach/db"],
  eslint: { ignoreDuringBuilds: true },
  serverExternalPackages: ["better-sqlite3"],
  // These are read via fs at runtime with a dynamically-computed path (see
  // packages/core/src/config.ts, packages/db/src/client.ts), which Next's
  // static output-file-tracing can't detect on its own — declare them
  // explicitly so they ship with the deployed serverless functions.
  outputFileTracingIncludes: {
    "/**": [
      "../../config/*.json",
      "../../data/demo.db",
      "../../packages/db/src/schema.sql",
    ],
  },
};

module.exports = nextConfig;
