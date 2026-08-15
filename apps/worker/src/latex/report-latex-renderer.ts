import { Buffer } from 'node:buffer';
import { reportContentSchema } from '@trace/shared';
import { reportInputSnapshotSchema, type ReportInputSnapshot } from '../reports/report-provider';

const MAX_LATEX_BYTES = 2 * 1024 * 1024;
const LATEX_ERROR = 'REPORT_RENDER_INVALID';

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

  const latex = `${preamble()}
\\begin{document}
${titlePage(snapshot.data, revision)}
\\newpage
\\thispagestyle{empty}
\\vspace*{2cm}
\\begin{tcolorbox}[colback=white,colframe=lightgray,boxrule=2pt,arc=0mm,width=\\textwidth,top=1cm,bottom=1cm,left=1cm,right=1cm]
\\begin{center}\\Large\\textbf{\\color{primarycolor}Executive Summary}\\end{center}
\\vspace{0.5cm}
${escapeLatex(content.data.executiveSummary)}
\\end{tcolorbox}
\\newpage
\\tableofcontents
\\newpage
\\section{Activity Overview}
${factsTable(snapshot.data.facts)}
${repositories}
\\end{document}
`;
  if (Buffer.byteLength(latex, 'utf8') > MAX_LATEX_BYTES) throw new Error(LATEX_ERROR);
  return latex;
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

function preamble(): string {
  return `\\documentclass[12pt,a4paper]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage{lmodern}
\\usepackage{booktabs}
\\usepackage[table,xcdraw]{xcolor}
\\usepackage{hyperref}
\\usepackage{fancyhdr}
\\usepackage{titlesec}
\\usepackage{enumitem}
\\usepackage{tcolorbox}
\\usepackage{tabularx}
\\usepackage{palatino}
\\definecolor{primarycolor}{RGB}{0, 51, 102}
\\definecolor{secondarycolor}{RGB}{0, 128, 128}
\\definecolor{lightgray}{RGB}{245,245,245}
\\definecolor{tableheadcolor}{RGB}{224,235,235}
\\hypersetup{colorlinks=true,linkcolor=primarycolor,urlcolor=secondarycolor,bookmarksnumbered=true,pdfborder={0 0 0}}
\\pagestyle{fancy}
\\fancyhf{}
\\fancyhead[L]{\\small\\textit{\\color{secondarycolor}Trace}}
\\fancyhead[R]{\\small\\textit{\\color{secondarycolor}Engineering Activity Report}}
\\fancyfoot[C]{\\thepage}
\\renewcommand{\\headrulewidth}{0.5pt}
\\renewcommand{\\headrule}{\\hbox to\\headwidth{\\color{primarycolor}\\leaders\\hrule height \\headrulewidth\\hfill}}
\\titleformat{\\section}{\\Large\\bfseries\\color{primarycolor}}{\\thesection}{1em}{}[\\titlerule]
\\titleformat{\\subsection}{\\large\\bfseries\\color{secondarycolor}}{\\thesubsection}{1em}{}
\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{0.65em}`;
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
  const accomplishments = content.accomplishments
    .map((item) => `\\item ${escapeLatex(item)}`)
    .join('\n');
  return `\\subsection{${escapeLatex(name)}}
${factsTable(contributor.facts)}
${escapeLatex(content.summary)}
\\begin{tcolorbox}[colback=white,colframe=secondarycolor,fonttitle=\\bfseries,title={Accomplishments}]
\\begin{itemize}[leftmargin=*]
${accomplishments}
\\end{itemize}
\\end{tcolorbox}`;
}
