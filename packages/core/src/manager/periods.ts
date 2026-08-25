/**
 * Turning the way people say time into an actual range.
 *
 * "What happened yesterday?", "compare this week with last week", "show me the
 * Friday report from three weeks ago" — all of these have to become a concrete
 * [start, end) pair before any query can run.
 *
 * Everything is computed against a caller-supplied `now`, never a hidden clock,
 * so the same phrase resolves identically in a test, in a request, and in a
 * scheduled run.
 */

export interface Period {
  start: string;
  end: string;
  /** How to name this period back to the owner: "yesterday", "week of 3 Aug". */
  label: string;
}

const DAY_MS = 86_400_000;

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function iso(d: Date): string {
  return d.toISOString();
}

function dayLabel(d: Date): string {
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** [start of that day, start of the next day) */
export function dayPeriod(day: Date, label?: string): Period {
  const start = startOfDay(day);
  const end = new Date(start.getTime() + DAY_MS);
  return { start: iso(start), end: iso(end), label: label ?? dayLabel(start) };
}

/** The 7 days ending at the start of today, i.e. the last full week of activity. */
export function rollingWeek(now: Date, weeksAgo = 0): Period {
  const end = new Date(startOfDay(now).getTime() + DAY_MS - weeksAgo * 7 * DAY_MS);
  const start = new Date(end.getTime() - 7 * DAY_MS);
  return {
    start: iso(start),
    end: iso(end),
    label: weeksAgo === 0 ? "the last 7 days" : `the 7 days ending ${dayLabel(new Date(end.getTime() - DAY_MS))}`,
  };
}

export function today(now: Date): Period {
  return dayPeriod(now, "today");
}

export function yesterday(now: Date): Period {
  return dayPeriod(new Date(startOfDay(now).getTime() - DAY_MS), "yesterday");
}

/** The immediately preceding period of the same length — for week-on-week comparisons. */
export function previousPeriodOf(period: Period): Period {
  const start = new Date(period.start).getTime();
  const end = new Date(period.end).getTime();
  const length = end - start;
  return {
    start: iso(new Date(start - length)),
    end: iso(new Date(start)),
    label: "the preceding period",
  };
}

/**
 * Best-effort period from free text. Returns null when nothing time-like is
 * present, so callers can apply their own default rather than silently getting
 * "today" for a question that had no timeframe in it.
 */
export function parsePeriod(text: string, now: Date): Period | null {
  const lower = text.toLowerCase();

  if (/\byesterday\b/.test(lower)) return yesterday(now);
  if (/\btoday\b|\bso far today\b/.test(lower)) return today(now);

  // "three weeks ago" / "2 weeks ago"
  const weeksAgo = lower.match(/\b(\d+|one|two|three|four|five|six)\s+weeks?\s+ago\b/);
  if (weeksAgo) {
    const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
    const n = Number(weeksAgo[1]) || words[weeksAgo[1]] || 1;
    return rollingWeek(now, n);
  }

  const daysAgo = lower.match(/\b(\d+)\s+days?\s+ago\b/);
  if (daysAgo) {
    return dayPeriod(new Date(startOfDay(now).getTime() - Number(daysAgo[1]) * DAY_MS));
  }

  if (/\blast\s+week\b|\bprevious\s+week\b/.test(lower)) return rollingWeek(now, 1);
  if (/\bthis\s+week\b|\blast\s+7\s+days\b|\bpast\s+week\b/.test(lower)) return rollingWeek(now, 0);
  if (/\blast\s+month\b|\bpast\s+month\b|\bthis\s+month\b/.test(lower)) {
    const end = new Date(startOfDay(now).getTime() + DAY_MS);
    const start = new Date(end.getTime() - 30 * DAY_MS);
    return { start: iso(start), end: iso(end), label: "the last 30 days" };
  }

  // "last Tuesday" / "on Friday" — the most recent occurrence of that weekday
  // that is strictly in the past, so "last Tuesday" said on a Tuesday means the
  // previous one rather than this morning.
  const weekday = WEEKDAYS.findIndex((d) => new RegExp(`\\b(last\\s+|on\\s+)?${d}\\b`).test(lower));
  if (weekday >= 0) {
    const start = startOfDay(now);
    let delta = start.getDay() - weekday;
    if (delta <= 0) delta += 7;
    return dayPeriod(new Date(start.getTime() - delta * DAY_MS));
  }

  return null;
}

/** Whether an ISO timestamp falls inside a period. Half-open: [start, end). */
export function withinPeriod(isoTimestamp: string | null | undefined, period: Period): boolean {
  if (!isoTimestamp) return false;
  const t = new Date(isoTimestamp).getTime();
  if (Number.isNaN(t)) return false;
  return t >= new Date(period.start).getTime() && t < new Date(period.end).getTime();
}

/**
 * Next time a daily/weekly schedule should fire, strictly after `after`.
 *
 * Timezone note: this computes against the server's clock. A named IANA zone is
 * stored on the task and shown back to the owner, but is NOT yet used to offset
 * the calculation — doing that correctly needs a timezone library, and guessing
 * at DST arithmetic would produce a schedule that silently drifts by an hour
 * twice a year. Tracked in NEEDS_OWNER_INPUT.md.
 */
export function nextRunAt(
  opts: { hour: number; minute: number; dayOfWeek: number | null },
  after: Date
): string {
  const candidate = new Date(after);
  candidate.setSeconds(0, 0);
  candidate.setHours(opts.hour, opts.minute, 0, 0);

  if (opts.dayOfWeek === null || opts.dayOfWeek === undefined) {
    if (candidate.getTime() <= after.getTime()) {
      candidate.setTime(candidate.getTime() + DAY_MS);
    }
    return iso(candidate);
  }

  let delta = opts.dayOfWeek - candidate.getDay();
  if (delta < 0) delta += 7;
  candidate.setTime(candidate.getTime() + delta * DAY_MS);
  if (candidate.getTime() <= after.getTime()) {
    candidate.setTime(candidate.getTime() + 7 * DAY_MS);
  }
  return iso(candidate);
}

/** Parses "every morning at 9", "every Friday at 5pm" into schedule parts. */
export function parseSchedule(text: string): {
  kind: "daily_report" | "weekly_report";
  hour: number;
  minute: number;
  dayOfWeek: number | null;
} | null {
  const lower = text.toLowerCase();
  if (!/\b(every|each|daily|weekly)\b/.test(lower)) return null;

  let hour = 9;
  let minute = 0;

  const explicit = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (explicit) {
    hour = Number(explicit[1]) % 12;
    if (explicit[3] === "pm") hour += 12;
    minute = explicit[2] ? Number(explicit[2]) : 0;
  } else {
    const bare = lower.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/);
    if (bare) {
      hour = Number(bare[1]);
      minute = bare[2] ? Number(bare[2]) : 0;
    } else if (/\bmorning\b/.test(lower)) {
      hour = 9;
    } else if (/\bevening\b/.test(lower)) {
      hour = 18;
    }
  }

  if (hour > 23 || minute > 59) return null;

  const weekdayIndex = WEEKDAYS.findIndex((d) => lower.includes(d));
  const weekly = weekdayIndex >= 0 || /\bweekly\b|\bevery\s+week\b/.test(lower);

  return {
    kind: weekly ? "weekly_report" : "daily_report",
    hour,
    minute,
    dayOfWeek: weekly ? (weekdayIndex >= 0 ? weekdayIndex : 5) : null,
  };
}
