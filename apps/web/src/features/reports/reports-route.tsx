"use client";

import { useEffect, useState } from "react";
import { ReportLifecycle } from "./report-lifecycle";
import { createFixtureReport, listFixtureReports } from "@/mocks/fixtures/reports";

export function dateInTimezone(now: Date, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
    return `${value("year")}-${value("month")}-${value("day")}`;
  } catch { return now.toISOString().slice(0, 10); }
}

export function ReportsRoute() {
  const [timezone, setTimezone] = useState("UTC");
  const [date, setDate] = useState(() => dateInTimezone(new Date(), "UTC"));
  useEffect(() => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    setTimezone(detected);
    setDate(dateInTimezone(new Date(), detected));
  }, []);
  return <ReportLifecycle key={`${date}:${timezone}`} loadReports={listFixtureReports} createReport={createFixtureReport} initialDate={date} timezone={timezone} />;
}
