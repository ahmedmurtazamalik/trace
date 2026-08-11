type ReportState = "STAGED" | "LOCAL_COMMIT" | "PUSHED" | "MERGED";

type ReportItem = {
  readonly id: string;
  readonly state: ReportState;
  readonly title: string;
  readonly detail: string;
  readonly actor: string;
  readonly timestamp: string;
  readonly paths: readonly string[];
  readonly evidence: readonly string[];
};

type ReportRepository = {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly items: readonly ReportItem[];
};

type ReportAccount = {
  readonly id: string;
  readonly displayName: string;
  readonly repositories: readonly ReportRepository[];
};

export type ReportViewModel = {
  readonly title: string;
  readonly windowLabel: string;
  readonly generatedAt: string;
  readonly accounts: readonly ReportAccount[];
};

const stateLabels: Record<ReportState, string> = {
  STAGED: "Work in progress",
  LOCAL_COMMIT: "Committed locally",
  PUSHED: "Pushed to GitHub",
  MERGED: "Merged",
};

const panelCopy = {
  generating: {
    eyebrow: "Report requested",
    title: "Generating your report",
    body: "Trace is freezing the evidence window and composing a reviewable draft.",
  },
  empty: {
    eyebrow: "No matching evidence",
    title: "No activity matched this scope",
    body: "Try a wider date window or include another authorized repository.",
  },
  error: {
    eyebrow: "Action required",
    title: "Report generation paused",
    body: "Your evidence is safe. Retry generation or inspect the recorded error.",
  },
} as const;

export function ReportStatePanel({
  state,
}: {
  readonly state: keyof typeof panelCopy;
}) {
  const copy = panelCopy[state];

  return (
    <section className={`report-state state-panel-${state}`} aria-live="polite">
      <span className="state-orbit" aria-hidden="true" />
      <div>
        <p className="eyebrow">{copy.eyebrow}</p>
        <h2>{copy.title}</h2>
        <p>{copy.body}</p>
      </div>
    </section>
  );
}

export function ReportView({ report }: { readonly report: ReportViewModel }) {
  return (
    <section className="report-shell" aria-labelledby="report-title">
      <header className="report-heading">
        <div>
          <p className="eyebrow">Evidence-backed activity report</p>
          <h1 id="report-title">{report.title}</h1>
        </div>
        <div className="report-meta">
          <strong>{report.windowLabel}</strong>
          <span>{report.generatedAt}</span>
        </div>
      </header>

      {report.accounts.map((account) => (
        <section className="account-section" key={account.id}>
          <div className="section-label">
            <span>Account</span>
            <h2>{account.displayName}</h2>
          </div>

          {account.repositories.map((repository) => (
            <article className="repository-card" key={repository.id}>
              <header className="repository-header">
                <div>
                  <p className="repository-kicker">Repository</p>
                  <h3>{repository.name}</h3>
                </div>
                <p>{repository.summary}</p>
              </header>

              <div className="activity-list">
                {repository.items.map((item) => (
                  <article className="activity-item" key={item.id}>
                    <div className="activity-state-row">
                      <span
                        className={`state-badge state-${item.state.toLowerCase()}`}
                      >
                        {stateLabels[item.state]}
                      </span>
                      <time>{item.timestamp}</time>
                    </div>
                    <h4>{item.title}</h4>
                    <p className="activity-detail">{item.detail}</p>
                    <p className="actor-line">{item.actor}</p>
                    <div className="path-list" aria-label="Changed paths">
                      {item.paths.map((path) => (
                        <code key={path}>{path}</code>
                      ))}
                    </div>
                    <details>
                      <summary>View evidence</summary>
                      <ul>
                        {item.evidence.map((entry) => (
                          <li key={entry}>{entry}</li>
                        ))}
                      </ul>
                    </details>
                  </article>
                ))}
              </div>
            </article>
          ))}
        </section>
      ))}
    </section>
  );
}
