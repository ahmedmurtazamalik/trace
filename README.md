# Trace Planning Package

Trace is an on-demand engineering activity and reporting system that combines authorized GitHub activity, opt-in local Git observations, repository context, and editable LaTeX/PDF reports.

This directory currently contains planning documents only. Application code, package installation, Git initialization, and provider setup have intentionally not been started.

## Read in this order

1. [`TRACE_MASTER_PLAN.md`](./TRACE_MASTER_PLAN.md) — authoritative scope, architecture, shared contracts, phases, testing, risks, and definition of done.
2. [`MURTAZA_PLAN.md`](./MURTAZA_PLAN.md) — Murtaza's web platform, database, GitHub App, ingestion, and integration responsibilities.
3. [`ALI_PLAN.md`](./ALI_PLAN.md) — Ali's CLI, report experience, AI synthesis, LaTeX, and frontend responsibilities.

If an individual plan conflicts with the master plan, the master plan wins until both developers explicitly update the decision together.

## Planning assumptions

- Team: Murtaza and Ali, both fresh graduates/new hires.
- Baseline duration: 15 working days, including integration and demo preparation.
- Tools and services must be free or open source for the MVP.
- GitHub personal accounts and GitHub organizations are both supported.
- A shared company GitHub account is treated as one opaque, reportable GitHub identity.
- GitHub App installations provide remote repository access.
- The opt-in Trace CLI observes staged changes and local commits while its explicit `trace start` watcher is active.
- Reports are generated only when requested.
- The final report is editable LaTeX with `.tex` and PDF downloads.
- The report theme will be implemented after the provided LaTeX baseline is received.

## First team meeting

Before writing code, spend 60–90 minutes together and complete these actions:

1. Read the master plan aloud and resolve unclear terms.
2. Confirm the presentation date and adjust the schedule without silently adding scope.
3. Decide who acts as repository maintainer; default: Murtaza.
4. Create the GitHub repository and protect `main`.
5. Add both collaborators and confirm each can create branches and pull requests.
6. Create the free Supabase project and development GitHub App together.
7. Record environment-variable names only; never commit values.
8. Agree that shared contracts and fixtures require both developers' review.

## Daily rhythm

- **Start of day — 10 minutes:** state yesterday's result, today's goal, and blocker.
- **Midday integration — 15 minutes:** pull `main`, run checks, resolve contract drift.
- **End of day — 20 minutes:** demo working behavior to each other and merge only green pull requests.

Use short-lived branches and small commits. Do not keep separate long-running “Murtaza” and “Ali” branches.

## Scope-change rule

A new feature may enter the MVP only by removing work of equal or greater effort. Record the exchange in the master plan before implementation.
