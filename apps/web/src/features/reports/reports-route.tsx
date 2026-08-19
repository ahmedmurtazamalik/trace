"use client";

import { useState } from "react";
import { ReportLifecycle } from "./report-lifecycle";
import { createReport, listReports } from "@/api/reports";
import { useAuthSession } from "@/auth/session-provider";
import { PAKISTAN_TIMEZONE, pakistanDateKey } from "@/lib/pakistan-time";

export function dateInTimezone(now: Date, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
    return `${value("year")}-${value("month")}-${value("day")}`;
  } catch { return now.toISOString().slice(0, 10); }
}

export function ReportsRoute() {
  const { csrfToken } = useAuthSession();
  const [timezone] = useState(PAKISTAN_TIMEZONE);
  const [date] = useState(() => pakistanDateKey(new Date()));
  const createLiveReport = (request: Parameters<typeof createReport>[0], signal?: AbortSignal) => {
    if (!csrfToken) throw new Error("Authenticated session is missing CSRF protection.");
    return createReport(request, csrfToken, signal);
  };
  return <ReportLifecycle key={`${date}:${timezone}`} loadReports={listReports} createReport={createLiveReport} initialDate={date} timezone={timezone} />;
}
