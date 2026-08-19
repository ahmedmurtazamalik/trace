export const PAKISTAN_TIMEZONE = "Asia/Karachi";

export function pakistanDateKey(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PAKISTAN_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function formatPakistanDateTime(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: PAKISTAN_TIMEZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
  return `${formatted.replace(/, (?=\d{1,2}:\d{2}:\d{2})/, " at ")} PKT`;
}

export function formatPakistanDate(value: Date | string, dateStyle: "medium" | "long" = "long") {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-US", { timeZone: PAKISTAN_TIMEZONE, dateStyle }).format(date);
}
