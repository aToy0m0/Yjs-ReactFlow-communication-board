export type DateDisplayFormat = "datetime" | "date" | "month" | "hour" | "time";

const CANONICAL_DATE = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})$/;

function validDate(year: number, month: number, day: number) {
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day;
}

function validTime(hour: number, minute: number) {
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

export function normalizeDateValue(value: string, format: DateDisplayFormat): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const canonical = CANONICAL_DATE.exec(trimmed);
  if (canonical) {
    const [, yearText, monthText, dayText, hourText, minuteText] = canonical;
    const year = Number(yearText); const month = Number(monthText); const day = Number(dayText);
    const hour = Number(hourText); const minute = Number(minuteText);
    const dateMatches = format === "month" ? day === 0 && month >= 1 && month <= 12
      : format === "hour" || format === "time" ? year === 0 && month === 0 && day === 0
        : validDate(year, month, day);
    const timeMatches = format === "datetime" || format === "time" ? validTime(hour, minute)
      : format === "hour" ? validTime(hour, 0) && minute === 0
        : hour === 0 && minute === 0;
    return dateMatches && timeMatches ? trimmed : null;
  }

  if (format === "datetime") {
    const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(trimmed);
    if (!match || !validDate(Number(match[1]), Number(match[2]), Number(match[3])) || !validTime(Number(match[4]), Number(match[5]))) return null;
    return `${match[1]}-${match[2]}-${match[3]}-${match[4]}${match[5]}`;
  }
  if (format === "date") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (!match || !validDate(Number(match[1]), Number(match[2]), Number(match[3]))) return null;
    return `${trimmed}-0000`;
  }
  if (format === "month") {
    const match = /^(\d{4})-(\d{2})$/.exec(trimmed);
    if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return null;
    return `${trimmed}-00-0000`;
  }
  const match = /^(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (!match) return null;
  const hour = Number(match[1]); const minute = Number(match[2] ?? 0);
  if (!validTime(hour, minute) || (format === "hour" && minute !== 0)) return null;
  return `0000-00-00-${match[1]}${String(minute).padStart(2, "0")}`;
}

export function dateInputValue(value: string, format: DateDisplayFormat) {
  const match = CANONICAL_DATE.exec(value);
  if (!match) return value;
  const [, year, month, day, hour, minute] = match;
  if (format === "datetime") return `${year}-${month}-${day}T${hour}:${minute}`;
  if (format === "date") return `${year}-${month}-${day}`;
  if (format === "month") return `${year}-${month}`;
  return `${hour}:${format === "hour" ? "00" : minute}`;
}

export function currentDatabaseTimestamp(source = new Date()) {
  const year = String(source.getFullYear()).padStart(4, "0");
  const month = String(source.getMonth() + 1).padStart(2, "0");
  const day = String(source.getDate()).padStart(2, "0");
  const hour = String(source.getHours()).padStart(2, "0");
  const minute = String(source.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}-${hour}${minute}`;
}
