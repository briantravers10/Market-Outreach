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

export function defaultDbPath(): string {
  const root = findRepoRoot();
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, "prospecting.db");
}
