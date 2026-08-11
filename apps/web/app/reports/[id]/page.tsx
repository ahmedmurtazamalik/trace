import { demoReport } from "@trace/fixtures/reports/demo";
import Link from "next/link";
import { ReportView } from "../../../components/reports/report-view";

export default function ReportPage() {
  return (
    <main className="page-frame">
      <div className="page-toolbar">
        <div>
          <p className="breadcrumb">Reports / Fixture preview</p>
          <p className="page-context">
            Review facts first. Trace does not estimate productivity or hours.
          </p>
        </div>
        <Link className="primary-action" href="/reports/new">
          Create report
        </Link>
      </div>

      <aside className="fixture-notice" aria-label="Preview notice">
        <span className="notice-icon" aria-hidden="true">
          i
        </span>
        <div>
          <strong>Deterministic demo fixture</strong>
          <p>
            This preview uses fixed local evidence. It is not connected to a
            live GitHub account yet.
          </p>
        </div>
      </aside>

      <ReportView report={demoReport} />

      <footer className="report-footer">
        <strong>Evidence, not performance scoring.</strong>
        <span>
          Trace reports observable repository activity and preserves
          uncertainty.
        </span>
      </footer>
    </main>
  );
}
