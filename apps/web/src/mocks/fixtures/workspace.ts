export const workspaceFixture = {
  disclosure: "Illustrative frontend data: no API, GitHub account, or database is connected.",
  metrics: [
    { label: "Activity today", value: "24", note: "Illustrative events" },
    { label: "Tracked repositories", value: "6", note: "Mock selection" },
    { label: "Contributors", value: "9", note: "Fixture identities" },
    { label: "Files changed", value: "38", note: "+1,248 / −316" },
  ],
  activity: [
    { repository: "trace/web", contributor: "Maya Chen", message: "Refine repository activity filters", time: "09:42" },
    { repository: "trace/api", contributor: "Noah Williams", message: "Add session boundary tests", time: "08:18" },
    { repository: "atlas/docs", contributor: "Priya Shah", message: "Document report revision flow", time: "Yesterday" },
  ],
} as const;
