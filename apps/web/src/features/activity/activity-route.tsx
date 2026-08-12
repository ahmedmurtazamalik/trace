"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { activityListQuerySchema, activityListResponseSchema, activitySourceSchema, activityTypeSchema, type ActivityListQuery, type ActivityListResponse } from "@trace/shared";
import { ActivityExperience, type ActivityFilters } from "./activity-experience";
import { activityFixtureItems } from "@/mocks/fixtures/activity";

async function loadFixtureActivity(query: Partial<ActivityListQuery>): Promise<ActivityListResponse> {
  const parsedQuery = activityListQuerySchema.parse(query);
  const filtered = activityFixtureItems.filter((item) =>
    (parsedQuery.date === undefined || item.occurredAt.slice(0, 10) === parsedQuery.date) &&
    (parsedQuery.repositoryId === undefined || item.repository.id === parsedQuery.repositoryId) &&
    (parsedQuery.contributorId === undefined || item.contributor?.id === parsedQuery.contributorId) &&
    (parsedQuery.source === undefined || item.source === parsedQuery.source) &&
    (parsedQuery.type === undefined || item.type === parsedQuery.type));
  const start = parsedQuery.cursor === "activity-page-2" ? 2 : 0;
  const items = filtered.slice(start, start + 2);
  const hasNextPage = start + items.length < filtered.length;
  return activityListResponseSchema.parse({ items, pageInfo: { nextCursor: hasNextPage ? "activity-page-2" : null, hasNextPage } });
}

function optionalValue(value: string | null) { return value || undefined; }
function validSource(value: string | null) { const result = activitySourceSchema.safeParse(value); return result.success ? result.data : undefined; }
function validType(value: string | null) { const result = activityTypeSchema.safeParse(value); return result.success ? result.data : undefined; }

export function ActivityRoute() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialFilters: ActivityFilters = {
    date: optionalValue(searchParams.get("date")),
    repositoryId: optionalValue(searchParams.get("repositoryId")),
    contributorId: optionalValue(searchParams.get("contributorId")),
    source: validSource(searchParams.get("source")),
    type: validType(searchParams.get("type")),
  };
  if (initialFilters.source && initialFilters.type) {
    const validPair = activityListQuerySchema.safeParse({ ...initialFilters, timezone: "UTC" });
    if (!validPair.success) initialFilters.type = undefined;
  }
  function update(filters: ActivityFilters) {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("cursor");
    const values = {
      date: filters.date,
      repositoryId: filters.repositoryId,
      contributorId: filters.contributorId,
      source: filters.source,
      type: filters.type,
    };
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    router.replace(next.size === 0 ? pathname : `${pathname}?${next.toString()}`, { scroll: false });
  }
  const timezone = searchParams.get("timezone") || "UTC";
  return <ActivityExperience loadActivity={loadFixtureActivity} initialFilters={initialFilters} timezone={timezone} onFiltersChange={update} />;
}
