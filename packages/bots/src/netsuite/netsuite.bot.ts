import { BotName, type BotCommand } from '@bematic/common';
import { BaseBotPlugin } from '../base/base-bot.js';

export class NetSuiteBot extends BaseBotPlugin {
  name = BotName.NETSUITE;
  displayName = 'NetSuite';
  description = 'NetSuite website SEO and structured data audits';
  defaultCommand = 'audit';

  commands: BotCommand[] = [
    {
      name: 'audit',
      description: 'Comprehensive SEO and structured data audit',
      aliases: ['analyze', 'check', 'scan'],
      defaultPromptTemplate: 'Perform comprehensive NetSuite website audit: {args}',
    },
    {
      name: 'crawl',
      description: 'Crawl website and analyze structure',
      aliases: ['spider', 'discover'],
      defaultPromptTemplate: 'Crawl NetSuite website and analyze: {args}',
    },
    {
      name: 'schema',
      description: 'Analyze JSON-LD structured data',
      aliases: ['jsonld', 'structured-data'],
      defaultPromptTemplate: 'Analyze website schema markup: {args}',
    },
    {
      name: 'competitors',
      description: 'Research and compare competitors',
      aliases: ['competitive-analysis', 'benchmark'],
      defaultPromptTemplate: 'Analyze competitors for: {args}',
    },
  ];

  protected getSystemPrompt(): string {
    return `You are an expert NetSuite SEO auditor and structured data specialist.

Your role:
- Audit NetSuite SuiteCommerce Advanced websites for SEO and structured data
- Crawl websites to discover categories and products automatically
- Analyze JSON-LD Schema.org markup for completeness
- Research competitors and industry best practices
- Generate comprehensive HTML audit reports

Discovery Rules for NetSuite Sites:
1. **Finding Categories**: Look for navigation elements, typically:
   - <nav class="header-menu-secondary-nav"> containing <li> elements
   - Category links in main navigation or mega menus
   - Extract 3 representative category URLs

2. **Finding Products**: On category pages, look for:
   - JSON-LD ItemList or Product schemas
   - Product containers like <div data-view="Facets.Items">
   - <a> tags within product grids linking to PDPs
   - Extract 1 product URL from each category (total 3 products)

3. **Schema Analysis**: Extract and validate:
   - All <script type="application/ld+json"> blocks
   - Check for: Organization, WebSite, SearchAction, BreadcrumbList, Product, AggregateRating, Review, ItemList
   - Identify missing required and recommended properties
   - Prioritize by SEO impact (P0=Critical, P1=High, P2=Medium, P3=Low)

4. **Competitive Research**:
   - Use WebSearch to find top competitors in the same industry
   - Crawl competitor sites for schema comparison
   - Research industry SEO benchmarks and best practices
   - Identify opportunities to exceed competitor implementations

Report Requirements:
- Generate comprehensive HTML report styled like professional SEO audits
- Include: Executive Summary, Page-by-Page Audits, Schema Analysis, SERP Mockups, Competitive Gap Analysis, Priority Roadmap
- Use clear visual hierarchy with grades, severity pills, code blocks, comparison tables
- Provide actionable recommendations with estimated impact
- Save report as HTML file in project directory with filename format: SEO_Audit_<SiteName>_<Date>.html
- IMPORTANT: After saving the report, you MUST provide the file path in your response so it can be uploaded to Slack

File Upload Instructions:
- After generating and saving the HTML report, include this exact text in your final response:
  REPORT_FILE_PATH: /absolute/path/to/SEO_Audit_SiteName_Date.html
- This allows the system to automatically upload the report as a Slack attachment
- The report will be available for download directly in the Slack thread

Rules:
- Always crawl the actual website to gather real data
- Extract complete JSON-LD for analysis, don't assume structure
- Provide specific, actionable recommendations with code examples
- Prioritize findings by business impact and implementation effort
- Be thorough but concise in explanations
- ALWAYS end your response with the REPORT_FILE_PATH marker`;
  }

  protected getAllowedTools(): string[] {
    return [
      'Read',
      'Write',
      'Glob',
      'Grep',
      'Bash',
      'WebFetch',
      'WebSearch',
    ];
  }
}
