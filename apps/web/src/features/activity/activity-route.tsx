"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ActivityListQuery, ActivityListResponse } from "@trace/shared";
import { ActivityExperience, type ActivityFilters } from "./activity-experience";
import { activityFixtureItems } from "@/mocks/fixtures/activity";

async function loadFixtureActivity(query: Partial<ActivityListQuery>): Promise<ActivityListResponse> {
  const filtered = activityFixtureItems.filter((item) =>
    (query.date === undefined || item.occurredAt.slice(0, 10) === query.date) &&
    (query.repositoryId === undefined || item.repository.id === query.repositoryId) &&
    (query.contributorId === undefined || item.contributor?.id === query.contributorId) &&
    (query.source === undefined || item.source === query.source) &&
    (query.type === undefined || item.type === query.type));
  const start = query.cursor === "activity-page-2" ? 2 : 0;
  const items = filtered.slice(start, start + 2);
  const hasNextPage = start + items.length < filtered.length;
  return { items, pageInfo: { nextCursor: hasNextPage ? "activity-page-2" : null, hasNextPage } };
}

export function ActivityRoute() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialFilters: ActivityFilters = {
    date: searchParams.get("date") || undefined,
    repositoryId: searchParams.get("repository") || undefined,
    contributorId: searchParams.get("contributor") || undefined,
    source: (searchParams.get("source") as ActivityFilters["source"]) || undefined,
    type: (searchParams.get("type") as ActivityFilters["type"]) || undefined,
  };
  function update(filters: ActivityFilters) {
    const next = new URLSearchParams();
    if (filters.date) next.set("date", filters.date);
    if (filters.repositoryId) next.set("repository", filters.repositoryId);
    if (filters.contributorId) next.set("contributor", filters.contributorId);
    if (filters.source) next.set("source", filters.source);
    if (filters.type) next.set("type", filters.type);
    router.replace(next.size === 0 ? pathname : `${pathname}?${next.toString()}`, { scroll: false });
  }
  return <ActivityExperience loadActivity={loadFixtureActivity} initialFilters={initialFilters} onFiltersChange={update} />;
}
