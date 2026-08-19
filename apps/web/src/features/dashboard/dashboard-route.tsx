"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { dashboardQuerySchema, dashboardResponseSchema, type DashboardQuery, type DashboardResponse } from "@trace/shared";
import { DashboardExperience, type DashboardFilters } from "./dashboard-experience";
import { dashboardFixtures } from "@/mocks/fixtures/dashboard";
import { getDashboard } from "@/api/dashboard";
import { listRepositories } from "@/api/repositories";
import { PAKISTAN_TIMEZONE, pakistanDateKey } from "@/lib/pakistan-time";

function localDate(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export async function loadFixtureDashboard(query: DashboardQuery): Promise<DashboardResponse> {
  const validatedQuery = dashboardQuerySchema.parse(query);
  const response = dashboardFixtures.ready;
  if (!response.recentActivity.some((item) => localDate(item.occurredAt, validatedQuery.timezone) === validatedQuery.date)) {
    return dashboardResponseSchema.parse({ ...dashboardFixtures.noActivity, date: validatedQuery.date, timezone: validatedQuery.timezone });
  }
  if (validatedQuery.repositoryId && validatedQuery.repositoryId !== response.recentActivity[0]?.repository.id) {
    return dashboardResponseSchema.parse({ ...dashboardFixtures.noActivity, date: validatedQuery.date, timezone: validatedQuery.timezone });
  }
  return dashboardResponseSchema.parse({ ...response, date: validatedQuery.date, timezone: validatedQuery.timezone });
}

export function dateInTimezone(now: Date, timezone: string) {
  try {
    return localDate(now.toISOString(), timezone);
  } catch {
    return localDate(now.toISOString(), "UTC");
  }
}

export function DashboardRoute() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const fallbackDate = pakistanDateKey(new Date());
  const candidate = dashboardQuerySchema.safeParse({
    date: searchParams.get("date") || fallbackDate,
    timezone: PAKISTAN_TIMEZONE,
    ...(searchParams.get("repositoryId") ? { repositoryId: searchParams.get("repositoryId") } : {}),
  });
  const { date, timezone, repositoryId } = candidate.success
    ? candidate.data
    : dashboardQuerySchema.parse({ date: pakistanDateKey(new Date()), timezone: PAKISTAN_TIMEZONE });
  function update(filters: DashboardFilters) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("date", filters.date);
    if (filters.repositoryId) next.set("repositoryId", filters.repositoryId);
    else next.delete("repositoryId");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }
  return <DashboardExperience loadDashboard={getDashboard} loadRepositories={listRepositories} initialDate={date} initialRepositoryId={repositoryId} timezone={timezone} onFiltersChange={update} />;
}
