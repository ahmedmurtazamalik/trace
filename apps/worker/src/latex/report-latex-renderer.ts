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
  '@@TRACE_EXECUTIVE_SUMMARY@@',
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

${factsTable(repository.facts)}

\\subsection{Repository Summary}
${escapeLatex(repositoryContent.summary)}

${contributors}`;
  }).join('\n');

  const latex = renderTemplate({
    '@@TRACE_TITLE_PAGE@@': titlePage(snapshot.data, revision),
    '@@TRACE_EXECUTIVE_SUMMARY@@': escapeLatex(content.data.executiveSummary),
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

function titlePage(snapshot: ReportInputSnapshot, revision: number): string {
  return `\\begin{titlepage}
\\centering
\\vspace*{1cm}
{\\huge\\bfseries\\color{primarycolor} Trace}\\\\[0.5cm]
{\\Huge\\bfseries Engineering Activity Report}\\\\[0.5cm]
\\rule{\\linewidth}{1mm}\\\\[0.8cm]
{\\LARGE\\bfseries ${escapeLatex(snapshot.reportDate)}}\\\\[1.5cm]
\\begin{tcolorbox}[colback=tableheadcolor,colframe=primarycolor,width=0.9\\textwidth,boxrule=1pt,arc=4mm]
\\centering
\\textbf{\\large On-demand factual engineering report}\\\\[0.2cm]
\\textit{Validated activity facts and revisioned structured narrative}
\\end{tcolorbox}
\\vfill
\\begin{minipage}{0.45\\textwidth}
\\begin{flushleft}
\\textbf{\\color{primarycolor}Report Date:}\\\\
${escapeLatex(snapshot.reportDate)}\\\\[0.4cm]
\\textbf{\\color{primarycolor}Timezone:}\\\\
${escapeLatex(snapshot.timezone)}
\\end{flushleft}
\\end{minipage}
\\hfill
\\begin{minipage}{0.45\\textwidth}
\\begin{flushright}
\\textbf{\\color{primarycolor}Revision:}\\\\
Revision ${revision}\\\\[0.4cm]
\\textbf{\\color{primarycolor}Generated by:}\\\\
Trace
\\end{flushright}
\\end{minipage}
\\vspace{1.5cm}
{\\large\\textbf{Grounded in immutable repository activity}}
\\end{titlepage}`;
}

function factsTable(facts: ReportInputSnapshot['facts']): string {
  return `\\begin{table}[ht!]
\\centering
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
\\end{table}`;
}

function renderContributor(
  contributor: ReportInputSnapshot['repositories'][number]['contributors'][number],
  content: { summary: string; accomplishments: string[] },
): string {
  const name = contributor.displayName ?? contributor.username ?? contributor.id;
  const accomplishments = content.accomplishments.length === 0
    ? '\\textit{No accomplishments recorded.}'
    : `\\begin{itemize}[leftmargin=*]
${content.accomplishments.map((item) => `\\item ${escapeLatex(item)}`).join('\n')}
\\end{itemize}`;
  return `\\subsection{${escapeLatex(name)}}
${factsTable(contributor.facts)}
${escapeLatex(content.summary)}
\\begin{tcolorbox}[colback=white,colframe=secondarycolor,fonttitle=\\bfseries,title={Accomplishments}]
${accomplishments}
\\end{tcolorbox}`;
}
