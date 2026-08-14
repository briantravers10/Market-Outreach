import fs from "node:fs";
import path from "node:path";

/** Same find-up strategy as packages/core/src/config.ts — see that file for why. */
export function findRepoRoot(): string {
  const candidates = [__dirname, process.cwd()];
  for (const start of candidates) {
    let dir = start;
    for (let i = 0; i < 8; i++) {
      if (fs.existsSync(path.join(dir, "config", "territories.json"))) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error(
    `Could not locate repo root starting from __dirname=${__dirname} or cwd=${process.cwd()}`
  );
}

/**
 * Public Vercel deployments of this skeleton serve a pre-seeded, read-only
 * snapshot (data/demo.db) instead of the local read-write dev database —
 * Vercel's serverless functions don't have persistent writable disk at
 * request time. Set via the DEMO_READ_ONLY=1 project env var; see
 * packages/db/src/client.ts.
 */
export function isDemoReadOnly(): boolean {
  return process.env.DEMO_READ_ONLY === "1";
}

/**
 * Vercel's *build* step (unlike its request-time runtime) does have a
 * writable filesystem, so demo.db is generated fresh on every deploy by
 * running the normal seed/run-campaign scripts with SEED_DB_PATH pointing at
 * it — see the root package.json "build:demo" script. When set, this takes
 * priority over DEMO_READ_ONLY so those scripts get a normal read-write
 * connection instead of the readonly one deployed requests get.
 */
export function defaultDbPath(): string {
  const root = findRepoRoot();

  if (process.env.SEED_DB_PATH) {
    const seedPath = path.join(root, process.env.SEED_DB_PATH);
    fs.mkdirSync(path.dirname(seedPath), { recursive: true });
    return seedPath;
  }

  if (isDemoReadOnly()) {
    return path.join(root, "data", "demo.db");
  }

  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, "prospecting.db");
}
