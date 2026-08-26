"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { CostEntry } from "@market-outreach/core";
import { getRepos } from "./data";
import { isDemoMode } from "./demo";

/**
 * Recording what things cost.
 *
 * The owner types an amount like "39" or "39.00" or "$39". All three mean the
 * same thing and all three have to land as the integer 3900, because the whole
 * value of this page is that its total matches a bank statement.
 */

/**
 * Parses a typed amount into integer minor units.
 *
 * Deliberately not `Math.round(Number(input) * 100)`. That is the obvious
 * version and it is wrong: 19.99 * 100 is 1998.9999999999998 in binary
 * floating point, and while Math.round saves that particular case, the same
 * trick loses a penny on other values. Splitting on the decimal point and
 * treating the halves as integers cannot drift.
 */
export async function parseAmountToMinor(raw: string): Promise<number | null> {
  const cleaned = raw.trim().replace(/[$£€,\s]/g, "");
  if (!cleaned) return null;
  if (!/^-?\d*(\.\d*)?$/.test(cleaned)) return null;

  const negative = cleaned.startsWith("-");
  const [wholeRaw = "0", fracRaw = ""] = cleaned.replace("-", "").split(".");
  const whole = Number.parseInt(wholeRaw || "0", 10);
  if (!Number.isFinite(whole)) return null;

  // Pad or truncate to exactly two digits: "5" -> 50 cents, "5555" -> 55.
  const frac = Number.parseInt((fracRaw + "00").slice(0, 2), 10);
  if (!Number.isFinite(frac)) return null;

  const minor = whole * 100 + frac;
  return negative ? -minor : minor;
}

function str(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function addCostAction(form: FormData): Promise<void> {
  if (isDemoMode) return;

  const amountMinor = await parseAmountToMinor(str(form, "amount"));
  const vendor = str(form, "vendor");
  if (amountMinor === null || amountMinor <= 0 || !vendor) return;

  const kind = str(form, "kind") === "usage" ? "usage" : "subscription";
  const intervalRaw = str(form, "interval");
  const unitsRaw = Number.parseInt(str(form, "units"), 10);

  const entry: CostEntry = {
    id: randomUUID(),
    kind,
    vendor,
    description: str(form, "description"),
    amountMinor,
    currency: (str(form, "currency") || "USD").toUpperCase().slice(0, 3),
    // An interval on a usage entry would make it recur forever, which is the
    // single most expensive way this page could lie.
    interval: kind === "subscription" ? (intervalRaw === "yearly" ? "yearly" : "monthly") : null,
    startedAt: str(form, "startedAt")
      ? new Date(`${str(form, "startedAt")}T00:00:00.000Z`).toISOString()
      : new Date().toISOString(),
    endedAt: null,
    units: kind === "usage" && Number.isFinite(unitsRaw) && unitsRaw > 0 ? unitsRaw : null,
    unitLabel: kind === "usage" ? str(form, "unitLabel") || "units" : null,
    automatic: false,
    createdAt: new Date().toISOString(),
  };

  await getRepos().costs.upsert(entry);
  revalidatePath("/spend");
  revalidatePath("/overview");
}

/** Ends a subscription rather than deleting it — what you already paid still happened. */
export async function endSubscriptionAction(form: FormData): Promise<void> {
  if (isDemoMode) return;
  const id = str(form, "id");
  if (!id) return;

  const repos = getRepos();
  const entry = await repos.costs.getById(id);
  if (!entry) return;

  await repos.costs.upsert({ ...entry, endedAt: new Date().toISOString() });
  revalidatePath("/spend");
  revalidatePath("/overview");
}

/** For a genuine mistake. Ending is nearly always the right action instead. */
export async function deleteCostAction(form: FormData): Promise<void> {
  if (isDemoMode) return;
  const id = str(form, "id");
  if (!id) return;

  await getRepos().costs.remove(id);
  revalidatePath("/spend");
  revalidatePath("/overview");
}
