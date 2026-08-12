"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { dashboardQuerySchema, dashboardResponseSchema, type DashboardQuery, type DashboardResponse } from "@trace/shared";
import { DashboardExperience, type DashboardFilters } from "./dashboard-experience";
import { dashboardFixtures } from "@/mocks/fixtures/dashboard";

async function loadFixtureDashboard(query: DashboardQuery): Promise<DashboardResponse> {
  const validatedQuery = dashboardQuerySchema.parse(query);
  const response = dashboardFixtures.ready;
  if (validatedQuery.repositoryId && validatedQuery.repositoryId !== response.recentActivity[0]?.repository.id) {
    return dashboardResponseSchema.parse({ ...dashboardFixtures.noActivity, date: validatedQuery.date, timezone: validatedQuery.timezone });
  }
  return dashboardResponseSchema.parse({ ...response, date: validatedQuery.date, timezone: validatedQuery.timezone });
}

export function DashboardRoute() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const candidate = dashboardQuerySchema.safeParse({
    date: searchParams.get("date") || "2026-08-12",
    timezone: searchParams.get("timezone") || "UTC",
    ...(searchParams.get("repositoryId") ? { repositoryId: searchParams.get("repositoryId") } : {}),
  });
  const { date, timezone, repositoryId } = candidate.success
    ? candidate.data
    : dashboardQuerySchema.parse({ date: "2026-08-12", timezone: "UTC" });
  function update(filters: DashboardFilters) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("date", filters.date);
    if (filters.repositoryId) next.set("repositoryId", filters.repositoryId);
    else next.delete("repositoryId");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }
  return <DashboardExperience loadDashboard={loadFixtureDashboard} initialDate={date} initialRepositoryId={repositoryId} timezone={timezone} onFiltersChange={update} />;
}
