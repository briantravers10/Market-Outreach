import type { SqlClient } from "../sqlClient";
import type { CostEntry, CostRepository } from "@market-outreach/core";

interface CostRow {
  id: string;
  kind: string;
  vendor: string;
  description: string;
  amount_minor: number;
  currency: string;
  interval: string | null;
  started_at: string;
  ended_at: string | null;
  units: number | null;
  unit_label: string | null;
  automatic: number | boolean;
  created_at: string;
}

function rowToEntry(row: CostRow): CostEntry {
  return {
    id: row.id,
    kind: row.kind as CostEntry["kind"],
    vendor: row.vendor,
    description: row.description,
    // SQLite hands back whatever was stored; a money column that has become a
    // float somewhere upstream must not silently propagate through the totals.
    amountMinor: Math.round(Number(row.amount_minor)),
    currency: row.currency,
    interval: (row.interval as CostEntry["interval"]) ?? null,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    units: row.units === null ? null : Number(row.units),
    unitLabel: row.unit_label,
    automatic: row.automatic === true || row.automatic === 1,
    createdAt: row.created_at,
  };
}

export class SqlCostsRepository implements CostRepository {
  constructor(private readonly db: SqlClient) {}

  async upsert(entry: CostEntry): Promise<CostEntry> {
    await this.db
      .prepare(
        `INSERT INTO costs (
           id, kind, vendor, description, amount_minor, currency, interval,
           started_at, ended_at, units, unit_label, automatic, created_at
         ) VALUES (
           @id, @kind, @vendor, @description, @amountMinor, @currency, @interval,
           @startedAt, @endedAt, @units, @unitLabel, @automatic, @createdAt
         )
         ON CONFLICT(id) DO UPDATE SET
           kind=excluded.kind, vendor=excluded.vendor, description=excluded.description,
           amount_minor=excluded.amount_minor, currency=excluded.currency, interval=excluded.interval,
           started_at=excluded.started_at, ended_at=excluded.ended_at,
           units=excluded.units, unit_label=excluded.unit_label`
      )
      .run({
        ...entry,
        // Rounded on the way in as well as out. A fractional amount reaching
        // the column at all would mean every total after it is suspect.
        amountMinor: Math.round(entry.amountMinor),
        automatic: entry.automatic ? 1 : 0,
      });
    return entry;
  }

  async list(): Promise<CostEntry[]> {
    const rows = (await this.db
      .prepare("SELECT * FROM costs ORDER BY started_at DESC")
      .all()) as CostRow[];
    return rows.map(rowToEntry);
  }

  async getById(id: string): Promise<CostEntry | null> {
    const row = (await this.db.prepare("SELECT * FROM costs WHERE id = ?").get(id)) as CostRow | undefined;
    return row ? rowToEntry(row) : null;
  }

  async remove(id: string): Promise<void> {
    await this.db.prepare("DELETE FROM costs WHERE id = ?").run(id);
  }
}
