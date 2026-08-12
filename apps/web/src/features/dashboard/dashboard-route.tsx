"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { DashboardQuery, DashboardResponse } from "@trace/shared";
import { DashboardExperience, type DashboardFilters } from "./dashboard-experience";
import { dashboardFixtures } from "@/mocks/fixtures/dashboard";

async function loadFixtureDashboard(query: DashboardQuery): Promise<DashboardResponse> {
  const response = dashboardFixtures.ready;
  if (query.repositoryId && query.repositoryId !== response.recentActivity[0]?.repository.id) {
    return { ...dashboardFixtures.noActivity, date: query.date, timezone: query.timezone };
  }
  return { ...response, date: query.date, timezone: query.timezone };
}

export function DashboardRoute() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const date = searchParams.get("date") || "2026-08-12";
  const timezone = searchParams.get("timezone") || "UTC";
  const repositoryId = searchParams.get("repositoryId") || undefined;
  function update(filters: DashboardFilters) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("date", filters.date);
    if (filters.repositoryId) next.set("repositoryId", filters.repositoryId);
    else next.delete("repositoryId");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }
  return <DashboardExperience loadDashboard={loadFixtureDashboard} initialDate={date} initialRepositoryId={repositoryId} timezone={timezone} onFiltersChange={update} />;
}
