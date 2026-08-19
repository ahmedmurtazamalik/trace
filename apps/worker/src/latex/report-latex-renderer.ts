import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { reportContentSchema } from '@trace/shared';
import { reportInputSnapshotSchema, type ReportInputSnapshot } from '../reports/report-provider';

const MAX_LATEX_BYTES = 2 * 1024 * 1024;
const MAX_TEMPLATE_BYTES = 128 * 1024;
const LATEX_ERROR = 'REPORT_RENDER_INVALID';
const TEMPLATE_MARKERS = [
  '@@TRACE_TITLE_PAGE@@',
  '@@TRACE_ACTIVITY_FACTS@@',
  '@@TRACE_REPOSITORIES@@',
] as const;
const REPORT_TEMPLATE = loadReportTemplate();

const ESCAPES: Readonly<Record<string, string>> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  '$': '\\$',
  '&': '\\&',
  '#': '\\#',
  '_': '\\_',
  '%': '\\%',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
};

export function escapeLatex(value: string): string {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code !== undefined && ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || (code >= 0x7f && code <= 0x9f))) {
      throw new Error(LATEX_ERROR);
    }
  }
  return value
    .replace(/\r\n?/g, '\n')
    .split('')
    .map((character) => ESCAPES[character] ?? character)
    .join('')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n\n');
}

export function renderReportLatex(snapshotInput: unknown, contentInput: unknown, revision: number): string {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error(LATEX_ERROR);
  const snapshot = reportInputSnapshotSchema.safeParse(snapshotInput);
  if (!snapshot.success) throw new Error(LATEX_ERROR);

  const content = reportContentSchema.safeParse(contentInput);
  if (!content.success || !matchesSnapshotStructure(snapshot.data, content.data)) throw new Error(LATEX_ERROR);

  const repositories = snapshot.data.repositories.map((repository) => {
    const repositoryContent = content.data.repositories.find((item) => item.repositoryId === repository.id);
    if (repositoryContent === undefined) throw new Error(LATEX_ERROR);
    const contributors = repository.contributors.map((contributor) => {
      const contributorContent = repositoryContent.contributors.find((item) => item.contributorId === contributor.id);
      if (contributorContent === undefined) throw new Error(LATEX_ERROR);
      return renderContributor(contributor, contributorContent);
    }).join('\n');
    return `
\\section{${escapeLatex(repository.fullName)}}

\\subsection{Activity Facts}
${factsTable(repository.facts)}

\\subsection{Code Analysis}
${analysisBullets([repositoryContent.summary])}

${contributors}`;
  }).join('\n');

  const latex = renderTemplate({
    '@@TRACE_TITLE_PAGE@@': reportHeader(snapshot.data, revision),

    '@@TRACE_ACTIVITY_FACTS@@': factsTable(snapshot.data.facts),
    '@@TRACE_REPOSITORIES@@': repositories,
  });
  if (Buffer.byteLength(latex, 'utf8') > MAX_LATEX_BYTES) throw new Error(LATEX_ERROR);
  return latex;
}

function loadReportTemplate(): string {
  try {
    const template = readFileSync(join(__dirname, 'templates', 'trace-report-theme.tex'), 'utf8');
    if (Buffer.byteLength(template, 'utf8') > MAX_TEMPLATE_BYTES) throw new Error(LATEX_ERROR);
    for (const marker of TEMPLATE_MARKERS) {
      if (template.split(marker).length !== 2) throw new Error(LATEX_ERROR);
    }
    return template;
  } catch {
    throw new Error(LATEX_ERROR);
  }
}

function renderTemplate(replacements: Record<(typeof TEMPLATE_MARKERS)[number], string>): string {
  let rendered = REPORT_TEMPLATE;
  for (const marker of TEMPLATE_MARKERS) rendered = rendered.replace(marker, replacements[marker]);
  if (rendered.includes('@@TRACE_')) throw new Error(LATEX_ERROR);
  return rendered;
}

function matchesSnapshotStructure(snapshot: ReportInputSnapshot, content: { repositories: Array<{
  repositoryId: string;
  contributors: Array<{ contributorId: string }>;
}> }): boolean {
  if (content.repositories.length !== snapshot.repositories.length) return false;
  return snapshot.repositories.every((repository) => {
    const renderedRepository = content.repositories.find((item) => item.repositoryId === repository.id);
    return renderedRepository !== undefined
      && renderedRepository.contributors.length === repository.contributors.length
      && repository.contributors.every((contributor) => renderedRepository.contributors.some(
        (item) => item.contributorId === contributor.id,
      ));
  });
}

function reportHeader(snapshot: ReportInputSnapshot, revision: number): string {
  return `{\\LARGE\\bfseries\\color{primarycolor} Compact Engineering Activity Report}\\\\[0.25cm]
\\textbf{Date:} ${escapeLatex(snapshot.reportDate)} \\quad
\\textbf{Timezone:} ${escapeLatex(snapshot.timezone)} \\quad
\\textbf{Revision:} ${revision}\\\\[0.2cm]
\\rule{\\linewidth}{0.6pt}`;
}

function factsTable(facts: ReportInputSnapshot['facts']): string {
  return `\\begin{center}
\\rowcolors{2}{white}{tableheadcolor}
\\begin{tabularx}{\\textwidth}{X r}
\\toprule
\\textbf{Metric} & \\textbf{Value} \\\\
\\midrule
Repositories & ${facts.repositoryCount} \\\\
Contributors & ${facts.contributorCount} \\\\
Commits & ${facts.commitCount} \\\\
Files changed & ${facts.filesChanged} \\\\
Additions & ${facts.additions} \\\\
Deletions & ${facts.deletions} \\\\
\\bottomrule
\\end{tabularx}
\\end{center}`;
}

function renderContributor(
  contributor: ReportInputSnapshot['repositories'][number]['contributors'][number],
  content: { summary: string; accomplishments: string[] },
): string {
  const name = contributor.displayName ?? contributor.username ?? contributor.id;
  const accomplishmentItems = content.accomplishments.length === 0
    ? ['No accomplishments recorded.']
    : content.accomplishments;
  return `\\subsection{Contributor: ${escapeLatex(name)}}
\\textbf{Activity Facts}
${factsTable(contributor.facts)}
\\textbf{Code Analysis}
${analysisBullets([content.summary, ...accomplishmentItems])}`;
}

function analysisBullets(values: string[], emptyMessage = 'No analysis recorded.'): string {
  const items = values.flatMap((value) => value.split(/\r?\n+/))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const safeItems = items.length === 0 ? [emptyMessage] : items;
  return `\\begin{itemize}
${safeItems.map((item) => `\\item ${escapeLatex(item)}`).join('\n')}
\\end{itemize}`;
}
