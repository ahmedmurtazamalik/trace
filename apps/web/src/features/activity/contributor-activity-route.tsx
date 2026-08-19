"use client";

import { listActivity } from "@/api/activity";
import { listRepositories } from "@/api/repositories";
import { ActivityExperience } from "./activity-experience";
import { PAKISTAN_TIMEZONE } from "@/lib/pakistan-time";

export function ContributorActivityRoute({ contributorId }: { contributorId: string }) {
  return <ActivityExperience
    fixedFilters={{ contributorId }}
    loadActivity={listActivity}
    loadRepositories={listRepositories}
    timezone={PAKISTAN_TIMEZONE}
  />;
}
