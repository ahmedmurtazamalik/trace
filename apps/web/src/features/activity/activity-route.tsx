"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { activityListQuerySchema, activityListResponseSchema, activitySourceSchema, activityTypeSchema, type ActivityListQuery, type ActivityListResponse } from "@trace/shared";
import { ActivityExperience, type ActivityFilters } from "./activity-experience";
import { activityFixtureItems } from "@/mocks/fixtures/activity";
import { listActivity } from "@/api/activity";
import { listRepositories } from "@/api/repositories";

function localDate(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export async function loadFixtureActivity(query: Partial<ActivityListQuery>): Promise<ActivityListResponse> {
  const parsedQuery = activityListQuerySchema.parse(query);
  const filtered = activityFixtureItems.filter((item) =>
    (parsedQuery.date === undefined || localDate(item.occurredAt, parsedQuery.timezone) === parsedQuery.date) &&
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
function validDate(value: string | null) {
  if (!value) return undefined;
  const result = activityListQuerySchema.safeParse({ date: value, timezone: "UTC" });
  return result.success ? result.data.date : undefined;
}
function validTimezone(value: string | null) {
  if (!value) return "UTC";
  const result = activityListQuerySchema.safeParse({ timezone: value });
  return result.success ? result.data.timezone : "UTC";
}

export function ActivityRoute() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialFilters: ActivityFilters = {
    date: validDate(searchParams.get("date")),
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
    const url = next.size === 0 ? pathname : `${pathname}?${next.toString()}`;
    window.history.replaceState(window.history.state, "", url);
  }
  const timezone = validTimezone(searchParams.get("timezone"));
  return <ActivityExperience loadActivity={listActivity} loadRepositories={listRepositories} initialFilters={initialFilters} timezone={timezone} onFiltersChange={update} />;
}
