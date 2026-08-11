export const demoReport = {
  title: "Weekly engineering evidence",
  windowLabel: "August 4–10, 2026 · UTC",
  generatedAt: "Evidence frozen August 10 at 18:00 UTC",
  accounts: [
    {
      id: "account-ali",
      displayName: "Ali",
      repositories: [
        {
          id: "repo-trace",
          name: "ahmedmurtazamalik/trace",
          summary:
            "Trace observed local work and matched it with GitHub-confirmed branch activity.",
          items: [
            {
              id: "evidence-staged",
              state: "STAGED",
              title: "Prepared CLI queue safeguards",
              detail:
                "The staged diff changes queue persistence and conflicting-write handling. It is not presented as completed work.",
              actor: "Observed for Ali by Trace CLI",
              timestamp: "August 10, 15:42 UTC",
              paths: ["apps/cli/src/queue/event-store.ts"],
              evidence: [
                "Staged fingerprint 8f42…d901",
                "1 path · +36 / −1 lines",
              ],
            },
            {
              id: "evidence-local",
              state: "LOCAL_COMMIT",
              title: "Recorded the durable queue implementation",
              detail:
                "A local Git commit exists, but this state does not claim that GitHub received it.",
              actor: "Authored by Ali",
              timestamp: "August 10, 15:58 UTC",
              paths: [
                "apps/cli/src/queue/event-store.ts",
                "apps/cli/tests/queue/event-store.test.ts",
              ],
              evidence: [
                "Local commit 20f6558",
                "Commit subject: add durable CLI event queue",
              ],
            },
            {
              id: "evidence-pushed",
              state: "PUSHED",
              title: "Published the CLI foundation branch",
              detail:
                "GitHub confirmed the branch update. Pusher and commit author remain separate evidence fields.",
              actor: "Pushed by alimajid266 · authored by Ali",
              timestamp: "August 10, 16:08 UTC",
              paths: ["apps/cli/src/index.ts", "README.md"],
              evidence: ["Commit 42ee093", "GitHub push delivery fixture-102"],
            },
            {
              id: "evidence-merged",
              state: "MERGED",
              title: "Integrated the workspace baseline",
              detail:
                "The fixture records a GitHub-confirmed merge without inferring effort, intent, or hours worked.",
              actor: "Merged on GitHub · authored by Ali",
              timestamp: "August 10, 17:31 UTC",
              paths: ["package.json", "pnpm-workspace.yaml", "tsconfig.json"],
              evidence: ["Merge fixture merge-018", "Target branch: main"],
            },
          ],
        },
      ],
    },
  ],
} as const;
