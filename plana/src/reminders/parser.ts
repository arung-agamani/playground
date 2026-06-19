import { parseDate } from "chrono-node";

export interface RecurrenceSpec {
  type: "daily" | "weekly" | "monthly";
  days?: number[];    // for weekly: 0=Sun..6=Sat, for monthly: 1-31
  weekdays?: boolean; // Mon-Fri
  weekends?: boolean; // Sat-Sun
}

export function parseWhen(input: string, timezone: string): Date {
  const trimmed = input.trim();

  const iso = Date.parse(trimmed);
  if (!Number.isNaN(iso)) {
    return floorToMinute(new Date(iso));
  }

  const results = parseDate(trimmed, { timezone });
  if (results) {
    return floorToMinute(results);
  }

  const localResults = parseDate(trimmed);
  if (localResults) {
    return floorToMinute(localResults);
  }

  throw new Error(
    `Could not parse time: "${input}". Try "in 30 minutes", "tomorrow 3pm", or ISO 8601.`,
  );
}

function floorToMinute(date: Date): Date {
  date.setUTCSeconds(0, 0);
  return date;
}

export function parseRecurrence(input: string): RecurrenceSpec | null {
  if (!input || input.trim() === "") return null;

  const s = input.trim().toLowerCase();

  if (s === "daily") return { type: "daily" };
  if (s === "weekly") return { type: "weekly" };
  if (s === "monthly") return { type: "monthly" };

  if (s === "weekday" || s === "weekdays") {
    return { type: "weekly", weekdays: true };
  }
  if (s === "weekend" || s === "weekends") {
    return { type: "weekly", weekends: true };
  }

  const prefixMatch = s.match(
    /^(daily|weekly|monthly)\s*:\s*(.+)$/,
  );
  if (prefixMatch) {
    const type = prefixMatch[1] as RecurrenceSpec["type"];
    const values = prefixMatch[2]!.split(/[, ]+/).filter(Boolean);

    if (type === "weekly") {
      const dayNames: Record<string, number> = {
        sun: 0,
        mon: 1,
        tue: 2,
        wed: 3,
        thu: 4,
        fri: 5,
        sat: 6,
        sunday: 0,
        monday: 1,
        tuesday: 2,
        wednesday: 3,
        thursday: 4,
        friday: 5,
        saturday: 6,
      };
      const days = values
        .map((v) => dayNames[v])
        .filter((d): d is number => d !== undefined);
      if (days.length > 0) return { type: "weekly", days };
    }

    if (type === "monthly") {
      const days = values.map(Number).filter((d) => d >= 1 && d <= 31);
      if (days.length > 0) return { type: "monthly", days };
    }
  }

  return null;
}

export function computeNextDue(
  currentDueAt: string,
  recurrence: RecurrenceSpec,
): string {
  const due = new Date(currentDueAt);
  const h = due.getUTCHours();
  const m = due.getUTCMinutes();
  const s = due.getUTCSeconds();

  const next = new Date(due);

  switch (recurrence.type) {
    case "daily":
      next.setUTCDate(next.getUTCDate() + 1);
      break;

    case "weekly": {
      if (recurrence.days && recurrence.days.length > 0) {
        const currentDay = next.getUTCDay();
        const sorted = [...recurrence.days].sort((a, b) => a - b);
        let found = false;
        for (const d of sorted) {
          if (d > currentDay) {
            next.setUTCDate(next.getUTCDate() + (d - currentDay));
            found = true;
            break;
          }
        }
        if (!found) {
          const wrapDays = 7 - currentDay + sorted[0]!;
          next.setUTCDate(next.getUTCDate() + wrapDays);
        }
      } else if (recurrence.weekdays) {
        let added = 1;
        next.setUTCDate(next.getUTCDate() + 1);
        while (next.getUTCDay() === 0 || next.getUTCDay() === 6) {
          next.setUTCDate(next.getUTCDate() + 1);
          added++;
          if (added > 3) break;
        }
      } else if (recurrence.weekends) {
        let added = 1;
        next.setUTCDate(next.getUTCDate() + 1);
        while (next.getUTCDay() !== 0 && next.getUTCDay() !== 6) {
          next.setUTCDate(next.getUTCDate() + 1);
          added++;
          if (added > 7) break;
        }
      } else {
        next.setUTCDate(next.getUTCDate() + 7);
      }
      break;
    }

    case "monthly": {
      const currentDate = next.getUTCDate();
      next.setUTCMonth(next.getUTCMonth() + 1);
      if (recurrence.days && recurrence.days.length > 0) {
        const sorted = [...recurrence.days].sort((a, b) => a - b);
        let found = false;
        for (const d of sorted) {
          if (d > currentDate) {
            next.setUTCDate(d);
            found = true;
            break;
          }
        }
        if (!found) {
          next.setUTCMonth(next.getUTCMonth() + 1);
          next.setUTCDate(sorted[0]!);
        }
      }
      break;
    }
  }

  next.setUTCHours(h, m, s, 0);
  return next.toISOString();
}

export function formatDueAt(isoString: string, timezone: string): string {
  const date = new Date(isoString);
  return date.toLocaleString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  });
}
