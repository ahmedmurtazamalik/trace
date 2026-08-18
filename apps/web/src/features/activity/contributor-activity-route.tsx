"use client";

import { listActivity } from "@/api/activity";
import { listRepositories } from "@/api/repositories";
import { ActivityExperience } from "./activity-experience";

export function ContributorActivityRoute({ contributorId }: { contributorId: string }) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  return <ActivityExperience
    fixedFilters={{ contributorId }}
    loadActivity={listActivity}
    loadRepositories={listRepositories}
    timezone={timezone}
  />;
}
