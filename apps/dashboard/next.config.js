/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@market-outreach/core", "@market-outreach/db"],
  eslint: { ignoreDuringBuilds: true },
  serverExternalPackages: ["better-sqlite3"],
};

module.exports = nextConfig;
