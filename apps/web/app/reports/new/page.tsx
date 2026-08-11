export default function NewReportPage() {
  return (
    <main className="page-frame narrow-frame">
      <div className="scope-heading">
        <p className="eyebrow">New report</p>
        <h1>Choose an evidence window</h1>
        <p>
          Scope the repositories and dates Trace may use. Generation remains
          read-only.
        </p>
      </div>

      <form className="scope-form" action="/reports/demo" method="get">
        <fieldset>
          <legend>Time window</legend>
          <div className="form-grid">
            <label>
              From
              <input type="date" name="from" defaultValue="2026-08-04" />
            </label>
            <label>
              To
              <input type="date" name="to" defaultValue="2026-08-10" />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Account and repository</legend>
          <label>
            GitHub account
            <select name="account" defaultValue="ali">
              <option value="ali">Ali</option>
            </select>
          </label>
          <label className="check-row">
            <input type="checkbox" name="repository" defaultChecked />
            <span>
              <strong>ahmedmurtazamalik/trace</strong>
              Include authorized GitHub and opt-in local observations
            </span>
          </label>
        </fieldset>

        <div className="scope-disclosure">
          <strong>Trace will not include</strong>
          <p>
            Unstaged files, file contents outside captured diffs, keystrokes,
            private messages, productivity scores, or estimated hours.
          </p>
        </div>

        <button className="primary-action" type="submit">
          Preview fixture report
        </button>
      </form>
    </main>
  );
}
