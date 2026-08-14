import fs from "node:fs";
import { defaultDbPath, closeDb } from "@market-outreach/db";

/** Deletes the local SQLite file (and WAL/SHM sidecars) so the next run starts clean. Local file only — never touches production data. */
function main() {
  closeDb();
  const dbPath = defaultDbPath();
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = `${dbPath}${suffix}`;
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      console.log(`Removed ${file}`);
    }
  }
  console.log("Database reset. Run `npm run seed` to repopulate with fake data.");
}

main();
