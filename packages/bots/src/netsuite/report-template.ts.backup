/**
 * HTML Report Template Generator for NetSuite SEO Audits
 *
 * Generates comprehensive, professionally styled HTML reports
 * based on audit data collected from website crawling.
 */

export interface AuditData {
  siteName: string;
  siteUrl: string;
  auditDate: string;
  overallGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  summary: {
    totalPagesAnalyzed: number;
    schemasEvaluated: number;
    richResultEligibility: string;
    reviewsFound: number;
  };
  pages: PageAudit[];
  competitors: CompetitorData[];
  roadmap: RoadmapPhase[];
}

export interface PageAudit {
  type: 'homepage' | 'category' | 'product';
  url: string;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  currentSchema: any;
  missingFields: MissingField[];
  visibleContent: ContentItem[];
  recommendations: string;
}

export interface MissingField {
  field: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  impact: string;
  details: string;
}

export interface ContentItem {
  name: string;
  present: boolean;
  inSchema: boolean;
}

export interface CompetitorData {
  name: string;
  url: string;
  features: Record<string, boolean | string>;
}

export interface RoadmapPhase {
  phase: number;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  title: string;
  effort: string;
  impact: string;
  items: string[];
  expectedImpact: string;
}

export function generateAuditReport(data: AuditData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>JSON-LD SEO Audit — ${data.siteName} | Bematic Manager</title>
${getStyles()}
</head>
<body>

${getHeader(data)}
${getCover(data)}
${getTableOfContents(data)}
${getExecutiveSummary(data)}
${getPageAudits(data)}
${getCompetitiveAnalysis(data)}
${getRoadmap(data)}
${getFooter()}

</body>
</html>`;
}

function getStyles(): string {
  return `<style>
  /* ── Reset & Base ──────────────────────────────────── */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { scroll-behavior: smooth; font-size: 16px; }
  body {
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    color: #1e293b; background: #f8fafc; line-height: 1.6;
  }
  img { max-width: 100%; }
  a { color: #2563eb; text-decoration: none; }
  a:hover { text-decoration: underline; }
  code, pre { font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace; }
  pre { overflow-x: auto; }

  /* ── Layout ────────────────────────────────────────── */
  .container { max-width: 1120px; margin: 0 auto; padding: 0 24px; }
  section { padding: 56px 0; }
  section + section { border-top: 1px solid #e2e8f0; }

  /* ── Header / Branding ─────────────────────────────── */
  .site-header {
    background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%);
    color: #fff; padding: 28px 0; position: sticky; top: 0; z-index: 100;
    box-shadow: 0 2px 12px rgba(0,0,0,.25);
  }
  .site-header .container {
    display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;
  }
  .brand { display: flex; align-items: center; gap: 14px; }
  .brand-icon {
    width: 44px; height: 44px; border-radius: 10px;
    background: linear-gradient(135deg, #38bdf8, #3b82f6);
    display: flex; align-items: center; justify-content: center;
    font-weight: 800; font-size: 20px; color: #fff;
  }
  .brand-name { font-size: 18px; font-weight: 700; letter-spacing: -.3px; }
  .header-meta { text-align: right; font-size: 13px; opacity: .75; }
  .header-meta strong { display: block; font-size: 14px; opacity: 1; }

  /* ── Cover ─────────────────────────────────────────── */
  .cover {
    background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0f172a 100%);
    color: #fff; padding: 80px 0 72px; text-align: center;
  }
  .cover h1 { font-size: 42px; font-weight: 800; letter-spacing: -.8px; margin-bottom: 12px; }
  .cover h1 span { color: #38bdf8; }
  .cover .subtitle { font-size: 20px; opacity: .8; max-width: 640px; margin: 0 auto 28px; }
  .cover-meta { display: flex; justify-content: center; gap: 32px; font-size: 14px; opacity: .6; flex-wrap: wrap; }

  /* ── Table of Contents ─────────────────────────────── */
  .toc { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 28px 32px; margin-top: -40px; position: relative; z-index: 10; box-shadow: 0 4px 24px rgba(0,0,0,.06); }
  .toc h2 { font-size: 18px; margin-bottom: 14px; color: #475569; text-transform: uppercase; letter-spacing: .5px; }
  .toc ol { columns: 2; column-gap: 32px; padding-left: 22px; }
  .toc li { margin-bottom: 6px; font-size: 15px; break-inside: avoid; }
  @media (max-width: 640px) { .toc ol { columns: 1; } }

  /* ── Typography ────────────────────────────────────── */
  h2.section-title {
    font-size: 30px; font-weight: 800; letter-spacing: -.5px; margin-bottom: 8px;
  }
  h2.section-title .num { color: #94a3b8; margin-right: 8px; }
  .section-lead { font-size: 17px; color: #64748b; margin-bottom: 32px; max-width: 720px; }
  h3 { font-size: 22px; font-weight: 700; margin: 32px 0 12px; }
  h4 { font-size: 17px; font-weight: 700; margin: 20px 0 8px; }

  /* ── Grade Badge ───────────────────────────────────── */
  .grade-row {
    display: flex; align-items: center; gap: 32px; flex-wrap: wrap;
    background: #fff; border: 1px solid #e2e8f0; border-radius: 16px;
    padding: 32px; margin-bottom: 32px; box-shadow: 0 4px 24px rgba(0,0,0,.05);
  }
  .grade-badge {
    width: 120px; height: 120px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 48px; font-weight: 900; color: #fff; flex-shrink: 0;
  }
  .grade-a { background: linear-gradient(135deg, #16a34a, #15803d); box-shadow: 0 6px 20px rgba(22,163,74,.35); }
  .grade-b { background: linear-gradient(135deg, #2563eb, #1d4ed8); box-shadow: 0 6px 20px rgba(37,99,235,.35); }
  .grade-c { background: linear-gradient(135deg, #f59e0b, #d97706); box-shadow: 0 6px 20px rgba(245,158,11,.35); }
  .grade-d { background: linear-gradient(135deg, #dc2626, #b91c1c); box-shadow: 0 6px 20px rgba(220,38,38,.35); }
  .grade-f { background: linear-gradient(135deg, #7f1d1d, #450a0a); box-shadow: 0 6px 20px rgba(127,29,29,.35); }
  .grade-info { flex: 1; min-width: 240px; }
  .grade-info h3 { margin-top: 0; font-size: 24px; }

  /* ── Pills ─────────────────────────────────────────── */
  .pill {
    display: inline-block; padding: 3px 10px; border-radius: 999px;
    font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .3px;
  }
  .pill-critical { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
  .pill-high { background: #fff7ed; color: #ea580c; border: 1px solid #fed7aa; }
  .pill-medium { background: #fefce8; color: #ca8a04; border: 1px solid #fef08a; }
  .pill-low { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; }
  .pill-p0 { background: #fef2f2; color: #dc2626; }
  .pill-p1 { background: #fff7ed; color: #ea580c; }
  .pill-p2 { background: #fefce8; color: #ca8a04; }
  .pill-p3 { background: #f0fdf4; color: #16a34a; }

  /* ── Cards ─────────────────────────────────────────── */
  .page-card {
    background: #fff; border: 1px solid #e2e8f0; border-radius: 16px;
    overflow: hidden; margin-bottom: 36px; box-shadow: 0 4px 24px rgba(0,0,0,.04);
  }
  .page-card-header {
    padding: 24px 28px; display: flex; align-items: center; justify-content: space-between;
    flex-wrap: wrap; gap: 12px; border-bottom: 1px solid #e2e8f0;
  }
  .page-card-header.hdr-critical { background: linear-gradient(135deg, #fef2f2, #fff1f2); }
  .page-card-header.hdr-high { background: linear-gradient(135deg, #fff7ed, #fffbeb); }
  .page-card-header h3 { margin: 0; font-size: 20px; }
  .page-card-header .url { font-size: 13px; color: #64748b; word-break: break-all; }
  .page-card-body { padding: 28px; }

  /* ── Code Blocks ───────────────────────────────────── */
  .code-block {
    background: #0f172a; color: #e2e8f0; border-radius: 10px;
    padding: 20px 24px; margin: 16px 0 24px; font-size: 13px;
    line-height: 1.55; overflow-x: auto; border: 1px solid #1e293b;
  }
  .code-block .comment { color: #64748b; }
  .code-block .key { color: #7dd3fc; }
  .code-block .string { color: #86efac; }

  /* ── Tables ────────────────────────────────────────── */
  .summary-table { width: 100%; border-collapse: collapse; margin: 24px 0; font-size: 15px; }
  .summary-table th { background: #f1f5f9; text-align: left; padding: 12px 16px; font-weight: 700; border-bottom: 2px solid #e2e8f0; }
  .summary-table td { padding: 12px 16px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  .summary-table tr:hover td { background: #f8fafc; }

  .competitor-table { width: 100%; border-collapse: collapse; font-size: 14px; margin: 20px 0; }
  .competitor-table th { background: #0f172a; color: #fff; padding: 12px 14px; text-align: center; }
  .competitor-table td { padding: 10px 14px; border-bottom: 1px solid #e2e8f0; text-align: center; }
  .competitor-table .check { color: #16a34a; font-weight: 700; }
  .competitor-table .cross { color: #dc2626; font-weight: 700; }

  /* ── Stat Cards ────────────────────────────────────── */
  .stat-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px; margin: 24px 0;
  }
  .stat-card {
    background: #fff; border: 1px solid #e2e8f0; border-radius: 12px;
    padding: 20px; text-align: center;
  }
  .stat-card .stat-value { font-size: 36px; font-weight: 800; letter-spacing: -1px; }
  .stat-card .stat-label { font-size: 13px; color: #64748b; margin-top: 4px; }
  .stat-red .stat-value { color: #dc2626; }
  .stat-green .stat-value { color: #16a34a; }
  .stat-amber .stat-value { color: #ea580c; }
  .stat-blue .stat-value { color: #2563eb; }

  /* ── Roadmap ───────────────────────────────────────── */
  .roadmap { position: relative; padding-left: 36px; margin: 24px 0; }
  .roadmap::before {
    content: ''; position: absolute; left: 15px; top: 0; bottom: 0;
    width: 3px; background: #e2e8f0; border-radius: 2px;
  }
  .roadmap-phase {
    position: relative; margin-bottom: 28px; padding: 20px 24px;
    background: #fff; border: 1px solid #e2e8f0; border-radius: 12px;
    box-shadow: 0 2px 8px rgba(0,0,0,.03);
  }
  .roadmap-phase::before {
    content: ''; position: absolute; left: -28px; top: 24px;
    width: 14px; height: 14px; border-radius: 50%;
    border: 3px solid #fff;
  }
  .roadmap-phase.rp-p0::before { background: #dc2626; box-shadow: 0 0 0 2px #dc2626; }
  .roadmap-phase.rp-p1::before { background: #ea580c; box-shadow: 0 0 0 2px #ea580c; }
  .roadmap-phase.rp-p2::before { background: #ca8a04; box-shadow: 0 0 0 2px #ca8a04; }
  .roadmap-phase.rp-p3::before { background: #16a34a; box-shadow: 0 0 0 2px #16a34a; }
  .roadmap-phase h4 { margin-top: 0; }
  .roadmap-phase ul { margin: 8px 0 0; padding-left: 20px; font-size: 14px; color: #475569; }

  /* ── Footer ────────────────────────────────────────── */
  .site-footer {
    background: #0f172a; color: #94a3b8; padding: 40px 0; font-size: 14px; text-align: center;
  }
  .site-footer strong { color: #fff; }

  /* ── Callouts ──────────────────────────────────────── */
  .callout {
    border-radius: 10px; padding: 16px 20px; margin: 16px 0;
    font-size: 14px; display: flex; gap: 12px;
  }
  .callout-icon { font-size: 20px; flex-shrink: 0; line-height: 1.4; }
  .callout-critical { background: #fef2f2; border-left: 4px solid #dc2626; }
  .callout-info { background: #eff6ff; border-left: 4px solid #2563eb; }
  .callout-success { background: #f0fdf4; border-left: 4px solid #16a34a; }
  .callout-warning { background: #fffbeb; border-left: 4px solid #f59e0b; }
</style>`;
}

function getHeader(data: AuditData): string {
  return `<header class="site-header">
  <div class="container">
    <div class="brand">
      <div class="brand-icon">B</div>
      <div>
        <div class="brand-name">Bematic Manager</div>
      </div>
    </div>
    <div class="header-meta">
      <strong>NetSuite SEO Audit</strong>
      ${data.siteName} &middot; ${data.auditDate}
    </div>
  </div>
</header>`;
}

function getCover(data: AuditData): string {
  return `<section class="cover">
  <div class="container">
    <h1>JSON-LD <span>Schema.org</span> Audit</h1>
    <p class="subtitle">Comprehensive analysis of structured data on ${data.siteUrl} and opportunities for enhanced rich results in search engines and AI answers.</p>
    <div class="cover-meta">
      <span>Audit Date<br>${data.auditDate}</span>
      <span>Pages Analyzed<br>${data.summary.totalPagesAnalyzed}</span>
      <span>Schemas Evaluated<br>${data.summary.schemasEvaluated}</span>
    </div>
  </div>
</section>`;
}

function getTableOfContents(data: AuditData): string {
  return `<div class="container">
  <nav class="toc">
    <h2>Contents</h2>
    <ol>
      <li><a href="#executive-summary">Executive Summary &amp; Overall Grade</a></li>
      ${data.pages.map((p, i) => `<li><a href="#page-${i}">Page Audit: ${p.title}</a></li>`).join('\n      ')}
      <li><a href="#competitive">Competitive Gap Analysis</a></li>
      <li><a href="#roadmap">Priority Roadmap &amp; ROI</a></li>
    </ol>
  </nav>
</div>`;
}

function getExecutiveSummary(data: AuditData): string {
  const gradeClass = `grade-${data.overallGrade.toLowerCase()}`;
  return `<section id="executive-summary">
  <div class="container">
    <h2 class="section-title"><span class="num">01</span> Executive Summary</h2>
    <p class="section-lead">Overall structured data analysis and key findings for ${data.siteName}.</p>

    <div class="grade-row">
      <div class="grade-badge ${gradeClass}">${data.overallGrade}</div>
      <div class="grade-info">
        <h3>Overall Structured Data Grade: ${data.overallGrade}</h3>
        <p>Analyzed ${data.summary.totalPagesAnalyzed} representative pages across the website. Current rich result eligibility: ${data.summary.richResultEligibility}. Found ${data.summary.reviewsFound} reviews that are not visible to search engines due to missing schema markup.</p>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat-card stat-red">
        <div class="stat-value">${data.summary.richResultEligibility}</div>
        <div class="stat-label">Current Rich Result Eligibility</div>
      </div>
      <div class="stat-card stat-amber">
        <div class="stat-value">${data.summary.reviewsFound}</div>
        <div class="stat-label">Reviews Not Visible to Google</div>
      </div>
    </div>

  </div>
</section>`;
}

function getPageAudits(data: AuditData): string {
  return data.pages.map((page, index) => {
    const severityClass = `hdr-${page.severity}`;
    const severityPill = `pill-${page.severity}`;

    return `<section id="page-${index}">
  <div class="container">
    <h2 class="section-title"><span class="num">${String(index + 2).padStart(2, '0')}</span> ${page.title} Audit</h2>
    <p class="section-lead">${page.type.charAt(0).toUpperCase() + page.type.slice(1)} page analysis.</p>

    <div class="page-card">
      <div class="page-card-header ${severityClass}">
        <div>
          <h3>${page.title}</h3>
          <div class="url">${page.url}</div>
        </div>
        <div>
          <span class="pill ${severityPill}">${page.severity.toUpperCase()}</span>
        </div>
      </div>
      <div class="page-card-body">
        <h4>Current JSON-LD</h4>
        <div class="code-block">${formatJson(page.currentSchema)}</div>

        ${page.missingFields.length > 0 ? `
        <h4>Missing Fields</h4>
        <table class="summary-table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Priority</th>
              <th>Impact</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            ${page.missingFields.map(f => `
            <tr>
              <td><code>${f.field}</code></td>
              <td><span class="pill pill-${f.priority.toLowerCase()}">${f.priority}</span></td>
              <td>${f.impact}</td>
              <td>${f.details}</td>
            </tr>
            `).join('')}
          </tbody>
        </table>
        ` : ''}

        <h4>Recommendations</h4>
        <div class="callout callout-info">
          <div class="callout-icon">i</div>
          <div>${page.recommendations}</div>
        </div>
      </div>
    </div>
  </div>
</section>`;
  }).join('\n\n');
}

function getCompetitiveAnalysis(data: AuditData): string {
  if (data.competitors.length === 0) {
    return '';
  }

  return `<section id="competitive">
  <div class="container">
    <h2 class="section-title"><span class="num">${String(data.pages.length + 2).padStart(2, '0')}</span> Competitive Gap Analysis</h2>
    <p class="section-lead">Comparison of structured data implementation across industry competitors.</p>

    <table class="competitor-table">
      <thead>
        <tr>
          <th>Feature</th>
          <th>${data.siteName}</th>
          ${data.competitors.map(c => `<th>${c.name}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${getCompetitorRows(data)}
      </tbody>
    </table>

    <div class="callout callout-warning">
      <div class="callout-icon">!</div>
      <div><strong>Opportunity:</strong> Several competitors have implemented key schema features that ${data.siteName} is missing. Implementing these would improve search visibility and rich result eligibility.</div>
    </div>
  </div>
</section>`;
}

function getCompetitorRows(data: AuditData): string {
  const allFeatures = new Set<string>();
  data.competitors.forEach(c => {
    Object.keys(c.features).forEach(f => allFeatures.add(f));
  });

  return Array.from(allFeatures).map(feature => {
    return `<tr>
      <td>${feature}</td>
      <td class="cross">&times;</td>
      ${data.competitors.map(c => {
        const value = c.features[feature];
        if (value === true) return '<td class="check">&check;</td>';
        if (value === false) return '<td class="cross">&times;</td>';
        return `<td>${value}</td>`;
      }).join('')}
    </tr>`;
  }).join('\n        ');
}

function getRoadmap(data: AuditData): string {
  return `<section id="roadmap">
  <div class="container">
    <h2 class="section-title"><span class="num">${String(data.pages.length + 3).padStart(2, '0')}</span> Priority Roadmap &amp; Expected ROI</h2>
    <p class="section-lead">Phased implementation plan ordered by business impact and technical effort.</p>

    <div class="roadmap">
      ${data.roadmap.map(phase => `
      <div class="roadmap-phase rp-${phase.priority.toLowerCase()}">
        <h4><span class="pill pill-${phase.priority.toLowerCase()}">Phase ${phase.phase} &mdash; ${phase.priority}</span> ${phase.title}</h4>
        <p style="font-size:13px; color:#64748b; margin-bottom:12px;">Estimated effort: ${phase.effort} &middot; Impact: ${phase.impact}</p>
        <ul>
          ${phase.items.map(item => `<li>${item}</li>`).join('\n          ')}
        </ul>
        <div class="callout callout-success" style="margin:12px 0 0">
          <div class="callout-icon">&#8593;</div>
          <div><strong>Expected Impact:</strong> ${phase.expectedImpact}</div>
        </div>
      </div>
      `).join('')}
    </div>
  </div>
</section>`;
}

function getFooter(): string {
  const year = new Date().getFullYear();
  return `<footer class="site-footer">
  <div class="container">
    <p><strong>Generated by Bematic Manager</strong> &middot; NetSuite SEO Audit Tool</p>
    <p style="margin-top:12px; font-size:12px; opacity:.6;">&copy; ${year} Bematic. Automated structured data analysis powered by Claude AI.</p>
  </div>
</footer>`;
}

function formatJson(obj: any): string {
  if (!obj) return '<span class="comment">// No schema found</span>';

  const json = JSON.stringify(obj, null, 2);
  return escapeHtml(json)
    .replace(/"([^"]+)":/g, '<span class="key">"$1"</span>:')
    .replace(/: "([^"]*)"/g, ': <span class="string">"$1"</span>');
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, m => map[m]!);
}
