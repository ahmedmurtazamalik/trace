# TRACE — MASTER EXECUTION PROMPT
## Frontend + Product Experience Owner

You have been given two specifications:

1. **Trace Web App + GitHub Integration Specification**
2. **Trace CLI Specification**

The first specification is the system you are building.

The second specification describes a **separate CLI that another developer will build later**.

## YOUR MOST IMPORTANT INSTRUCTION

**DO NOT BUILD THE CLI.**

The CLI specification exists only so you understand the future system.

You need to understand:

- the future CLI's user/device identity
- how local repositories are identified
- how CLI activity will eventually enter Trace
- how GitHub and CLI activity differ
- why commits must be deduplicated
- why CLI activity is private to its Trace user
- how the report system will eventually combine GitHub and CLI activity

Your responsibility is primarily the **Trace web application frontend, UX, API integration, report experience, and frontend-side architecture**.

---

# 1. UNDERSTAND THE COMPLETE PRODUCT

Trace has two kinds of activity sources.

Today:

    GitHub
       ↓
    Trace

Later:

    Developer computer
       ↓
    Trace CLI
       ↓
    Trace API
       ↓
    Trace

Both eventually become:

    Trace Activity

The UI should therefore talk about:

    Activity

rather than hard-coding assumptions such as:

    GitHub-only activity

wherever possible.

---

# 2. DO NOT BUILD THE CLI

Never create:

- CLI commands
- CLI binaries
- Git scanners
- local repository watchers
- CLI installers
- CLI credential storage
- CLI enrollment implementation
- CLI background services

The CLI is another developer's responsibility.

You may understand and document its future API.

---

# 3. UNDERSTAND THE FUTURE CLI IDENTITY

The future CLI will be generic.

Users will eventually receive a one-time enrollment token and use it to associate a CLI installation/device with their Trace account.

Conceptually:

    Trace Account
         │
         └── CLI Device
                  │
                  └── CLI Credential

The frontend should therefore not assume:

    one user = one computer

or:

    GitHub account = Trace account

The primary identity remains:

    Trace User

GitHub and CLI are integrations attached to that user.

---

# 4. UNDERSTAND ACTIVITY SOURCES

The future activity system may contain:

    github / commit
    github / push

and later:

    cli / working_tree_snapshot
    cli / staged_change
    cli / untracked_file
    cli / local_commit

Design components so they can eventually display source information when useful.

Do not build CLI-specific UI unless the web-app specification requires it.

Do not create a fake CLI dashboard.

---

# 5. UNDERSTAND COMMIT DEDUPLICATION

A local commit may first be seen by the CLI and later by GitHub.

Example:

    local commit:
        abc123

    push:
        abc123

The system must understand these as the same canonical commit.

The frontend should therefore display canonical activity rather than blindly rendering every ingestion event as separate work.

If the backend exposes source metadata, use it intelligently.

Do not create duplicate UI entries merely because two ingestion mechanisms observed the same commit.

---

# 6. UNDERSTAND LOCAL-ONLY REPOSITORIES

The future CLI can discover:

    local Git repository
        ↓
    no GitHub origin

The UI architecture should not fundamentally assume every repository has a GitHub URL.

However, do not build local-only repository functionality now unless required by the web-app specification.

Simply avoid component/data-model assumptions that make:

    repository.githubUrl

mandatory everywhere.

---

# 7. TRACE ACCOUNT ≠ GITHUB ACCOUNT

The user first creates:

    Trace account

Then connects:

    GitHub account

The UI must clearly communicate this.

The login page is:

    Trace login

not:

    Login with GitHub

GitHub is an integration.

---

# 8. BUILD THE WEB APPLICATION COMPLETELY

Implement the frontend described in the Web App + GitHub Integration specification.

This includes:

- Registration
- Login
- Password reset
- Dashboard
- GitHub connection
- GitHub settings
- Repository selection
- Repository tracking
- Activity timeline
- Activity filters
- Repository views
- Contributor views
- Report generation
- Report history
- Report details
- PDF download
- Loading/error/empty states
- Responsive layout
- Accessibility

Use a clean, professional developer-tool aesthetic.

---

# 9. API CONTRACTS

Treat backend APIs as contracts.

Do not make the UI depend on backend implementation details.

Use typed DTOs/schemas where appropriate.

If Person A's backend endpoint is not available yet:

    use mock data

Do not wait.

Do not write frontend code that reaches into the backend database.

The frontend only communicates through the API.

---

# 10. AUTHENTICATION UX

Implement:

    Register
    Login
    Logout
    Forgot password
    Reset password
    Session expiration handling

The frontend must never store the primary authentication token in localStorage.

Use the backend's secure session architecture.

Handle:

    unauthenticated
    authenticated
    session expired
    account disabled
    server error

states cleanly.

---

# 11. GITHUB CONNECTION UX

The GitHub flow should be understandable:

    Create Trace account
        ↓
    Dashboard
        ↓
    Connect GitHub
        ↓
    GitHub authorization
        ↓
    Return to Trace
        ↓
    Select repositories
        ↓
    Start tracking

Show clear status.

For example:

    GitHub
    Connected as @alice

    Installation
    Active

    Repositories
    3 repositories tracked

Do not confuse:

    GitHub access

with:

    Trace tracking

---

# 12. REPOSITORY SELECTION UX

A user may have dozens or hundreds of repositories.

The interface must make selection practical.

Provide:

- Search
- Filtering
- Clear repository names
- Owner/name
- Private/public state
- Default branch
- Tracking status
- Enable/disable action

Make it obvious which repositories:

    Trace can access

versus:

    Trace is actually tracking

Do not make users repeatedly navigate through multiple pages to enable tracking.

---

# 13. DASHBOARD

The dashboard should answer:

> What work happened today?

Display:

- Total activity
- Repositories
- Contributors
- Commits
- Files changed
- Additions
- Deletions
- Recent work

Use clear visual hierarchy.

Avoid meaningless graphs.

Prefer useful development metrics.

---

# 14. ACTIVITY PAGE

The activity page is one of the core Trace experiences.

Users should be able to filter:

    Date
    Repository
    Contributor
    Activity type

Display:

    Contributor
    Repository
    Commit
    Commit message
    Timestamp
    Files changed
    Additions
    Deletions

Do not overwhelm users with raw GitHub webhook details.

Present the meaningful work.

---

# 15. CONTRIBUTORS

Remember:

A contributor does not necessarily have a Trace account.

For example:

    Alice — Trace user
    Bob — GitHub contributor
    Charlie — GitHub contributor

All can appear in repository activity.

Do not display:

    "Bob needs a Trace account"

unless the product explicitly introduces such functionality.

---

# 16. REPORT EXPERIENCE

The report system eventually combines:

    GitHub activity
    +
    CLI activity

The UI should therefore describe reports as:

    Development activity

rather than:

    GitHub activity only

unless the specific screen is explicitly about GitHub.

The report workflow:

    Select date
        ↓
    Generate
        ↓
    Processing
        ↓
    AI summary
        ↓
    PDF ready

Show clear progress.

---

# 17. REPORT CONTENT

Reports should display:

    Executive summary

    Repository sections

        Repository
        Summary
        Contributors
        Accomplishments

    Statistics

Do not expose raw AI JSON.

Do not expose raw prompts.

Do not expose internal AI errors unnecessarily.

If generation fails, give a useful human-readable error.

---

# 18. PDF DOWNLOAD

The UI should provide:

    View report
    Download PDF

Do not attempt to generate LaTeX in the browser.

Do not compile PDFs in the browser.

The backend worker owns report generation.

The frontend consumes the report API.

---

# 19. FUTURE CLI COMPATIBILITY

Do not build CLI functionality.

But when designing frontend models/components, avoid assumptions such as:

    source === github

being universally true.

For example, an activity component should conceptually be able to accept:

    {
      source: "github",
      type: "commit"
    }

Later it may receive:

    {
      source: "cli",
      type: "working_tree_snapshot"
    }

without requiring the entire component architecture to be rewritten.

Do not implement the latter now.

---

# 20. PRIVACY BOUNDARY

This is critical.

GitHub repository activity may be visible to multiple Trace users tracking the repository.

Future CLI activity is different.

CLI activity is associated with:

    Trace user
    CLI device

and may contain private local-development information.

The frontend must never assume:

    repository access = access to every user's activity

Backend authorization remains authoritative.

The frontend should consume only the data the API returns.

Never expose data merely because it exists in a repository-level response.

---

# 21. FOLLOW THE TWO-PERSON DEVELOPMENT PLAN

You are **Person B**.

Another developer is **Person A**.

Follow the Person B column of the 14-day plan exactly.

Do not implement Person A's backend tasks.

If an API does not exist yet:

    use mocks

Do not block on Person A.

Use the sequential day structure.

Do not move work from a later day into an earlier day just because it would be convenient.

---

# 22. SHARED REPOSITORY RULES

Another developer is editing the same repository.

Therefore:

- Keep frontend changes within frontend-owned areas.
- Do not rewrite backend files.
- Do not modify backend architecture unnecessarily.
- Avoid broad formatting changes.
- Do not rename shared contracts casually.
- Do not delete files you did not create.
- Keep commits focused.
- Use mocks when backend functionality is not yet available.

If a shared API contract needs a change:

1. Identify the problem.
2. Make the smallest compatible change.
3. Document it.
4. Tell the other developer what changed.

---

# 23. BEFORE CODING

Inspect the repository first.

Determine:

- Existing frontend
- Existing backend
- Shared packages
- Existing routes
- Existing components
- Existing styling
- Existing API client
- Existing tests
- Existing authentication logic

If empty:

    initialize according to the specification.

If partially implemented:

    continue from existing code.

Do not blindly overwrite working code.

---

# 24. UI QUALITY

Do not create a generic template dashboard.

Trace should feel like a real developer productivity/work-tracking product.

Prioritize:

- Information hierarchy
- Fast navigation
- Clear status
- Good empty states
- Good error states
- Responsive layout
- Accessibility
- Keyboard support
- Consistent spacing
- Consistent typography
- Reusable components

Avoid:

- excessive animations
- decorative charts
- unnecessary gradients
- giant hero sections inside authenticated screens
- meaningless metrics

---

# 25. TESTING

Test:

- Registration
- Login
- Logout
- Protected routes
- GitHub connection
- Repository selection
- Tracking toggles
- Dashboard
- Activity filters
- Activity pagination
- Report creation
- Report status
- Report display
- PDF download

Use mocked backend responses where required.

Use Playwright for end-to-end flows.

Do not require real GitHub credentials for automated tests.

---

# 26. DO NOT FAKE COMPLETION

If backend functionality is unavailable, do not pretend it works.

Use:

    mock API
    fixture data
    loading state

until the real endpoint is available.

When the real backend becomes available, integrate it and remove the relevant mock.

---

# 27. FINAL VALIDATION

Verify:

### Authentication

- Register
- Login
- Logout
- Session expiration
- Password reset

### GitHub

- Connect
- Connected state
- Disconnect
- Repository discovery
- Repository selection

### Activity

- Dashboard
- Activity timeline
- Filters
- Repository view
- Contributor view

### Reports

- Select date
- Generate
- Processing
- Completed
- Failed
- View
- Download

### Future CLI compatibility

Verify that the UI architecture does not require:

    GitHub activity

to be the only possible activity source.

The future CLI must be able to feed additional activity into the same conceptual activity system without forcing a frontend rewrite.

Again:

**Do not build the CLI.**

---

# 28. FINAL RESPONSE

When finished, report:

1. Frontend features implemented.
2. Components/pages created.
3. API contracts consumed.
4. Authentication behavior.
5. GitHub UX.
6. Repository management UX.
7. Activity UX.
8. Report UX.
9. How the architecture remains compatible with the future CLI.
10. Tests actually run.
11. Build results.
12. Remaining issues.

Do not claim the CLI exists.

Do not implement it.

Your goal is to make the Trace web application an excellent product **and make the future CLI integration feel like a natural extension rather than a rewrite**.