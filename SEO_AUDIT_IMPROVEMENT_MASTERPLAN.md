# 🎯 SEO Audit System Improvement — Master Plan

**Date**: February 20, 2026
**Based On**: Feedback from `/Work/Bematic/manager/SEO_Audit_ChristianArtGifts_2026-02-19.html`
**Status**: Planning Phase

---

## 📋 Issues Identified & Solutions

### 1. ✅ **ISSUE**: Missing Crawled URLs Table
**Problem**: No visibility into which URLs were actually crawled during the audit

**Solution**:
- Add new section **"Crawled URLs"** immediately after Executive Summary
- Show table with columns: URL, Type (Homepage/Category/Product), Status (200/404/etc), Response Time
- Group by page type for better organization

**Files to Modify**:
- `packages/bots/src/netsuite/report-template.ts` - Add `getCrawledUrlsSection()`
- `packages/bots/src/netsuite/netsuite.bot.ts` - Update prompt to include crawled URLs list
- Interface: Add `crawledUrls: Array<{url: string, type: string, status: number, responseTime: number}>` to `AuditData`

**Priority**: P1 (High)
**Effort**: 1 hour

---

### 2. ✅ **ISSUE**: Incomplete Schema.org Element Coverage
**Problem**: Bot not considering all available Schema.org types for e-commerce

**Current Coverage**: Organization, WebSite, SearchAction, BreadcrumbList, Product, AggregateRating, Review, ItemList

**Missing E-commerce Elements**:
- `Offer` (price, availability, currency)
- `Brand` (brand information)
- `ImageObject` (product images)
- `VideoObject` (product videos)
- `FAQPage` (FAQ sections)
- `HowTo` (instructional content)
- `Question` / `Answer` (Q&A sections)
- `SiteNavigationElement` (navigation menus)
- `WPHeader` / `WPFooter` (header/footer markup)
- `ContactPoint` (customer service contact)
- `PostalAddress` (business address)
- `OpeningHoursSpecification` (business hours)
- `QuantitativeValue` (measurements, dimensions)

**Solution**:
- Research comprehensive Schema.org e-commerce types via https://schema.org/docs/full.html
- Create mapping of recommended schemas by page type:
  - Homepage: Organization, WebSite, SearchAction, SiteNavigationElement, ContactPoint
  - Category: BreadcrumbList, ItemList, OfferCatalog
  - Product: Product, Offer, Brand, ImageObject, AggregateRating, Review, BreadcrumbList
- Update bot prompt with complete checklist
- Add schema completeness scoring (e.g., "Product page has 6/12 recommended schemas")

**Files to Modify**:
- `packages/bots/src/netsuite/netsuite.bot.ts` - Expand schema checklist
- `packages/bots/src/netsuite/report-template.ts` - Add schema completeness scoring
- Create new file: `packages/netsuite/src/services/seo/schema-definitions.ts` - Schema type definitions

**Priority**: P0 (Critical)
**Effort**: 3 hours
**Research Required**: 30 min to document all e-commerce schema types

---

### 3. ✅ **ISSUE**: Missing Alt Tag Images Not Listed
**Problem**: Report says "15 images missing alt tags" but doesn't show which images

**Current**: Generic count without details
**Expected**: Full list of images with actual `<img>` tag markup

**Solution**:
- Enhance `ImageIssue` interface to include full HTML tag snippet
- Extract and display first 100 chars of image src in issue list
- Format as: `<img src="/images/hero-banner.jpg" width="1200" height="600">` (escape HTML)
- Limit displayed issues to first 20, show "... and X more" for remainder
- Provide complete list in expandable/collapsible section

**Files to Modify**:
- `packages/netsuite/src/services/seo/seo-service.ts` - `extractImages()` to capture full tag
- `packages/bots/src/netsuite/report-template.ts` - `getImageAuditSection()` to display HTML tags
- Interface: Enhance `ImageIssue` with `htmlTag: string` property

**Priority**: P0 (Critical)
**Effort**: 1 hour

---

### 4. ✅ **ISSUE**: False Positives for Missing Alt Tags
**Problem**: Flagging prefetch/API call `<link>` tags as missing alt attributes

**Example False Positives**:
- `<link rel="prefetch" href="/api/items">`
- `<link rel="preload" href="/fonts/font.woff2">`
- `<link rel="dns-prefetch" href="//cdn.example.com">`

**Solution**:
- Filter `extractImages()` to ONLY analyze `<img>` tags
- Explicitly exclude `<link>`, `<script>`, `<a>`, `<iframe>` tags
- Add validation: Only process tags that start with `<img `
- Add test cases to ensure no false positives

**Files to Modify**:
- `packages/netsuite/src/services/seo/seo-service.ts` - Fix `extractImages()` regex/logic
- Ensure regex is: `/<img\s+([^>]+)>/gi` (already correct, but verify implementation)

**Priority**: P0 (Critical)
**Effort**: 30 min

---

### 5. ✅ **ISSUE**: HTML Size Calculation Incorrect for SPAs
**Problem**: Only counting HTML size, not HTML + JS + CSS for NetSuite SPAs

**Current**: Only measures initial HTML response
**Expected**: Total page weight (HTML + JS + CSS + critical assets)

**Solution**:
- Create new method: `calculateTotalPageWeight(html: string, baseUrl: string)`
- Extract all `<script src="...">` URLs from HTML
- Extract all `<link rel="stylesheet" href="...">` URLs from HTML
- Make parallel HEAD requests to get Content-Length headers
- Sum: HTML size + all JS sizes + all CSS sizes
- Add to performance metrics:
  - `htmlSizeKB` (current)
  - `totalJsSizeKB` (new)
  - `totalCssSizeKB` (new)
  - `totalPageWeightKB` (new - sum of all)
- Update performance grade to use total page weight

**Files to Modify**:
- `packages/netsuite/src/services/seo/seo-service.ts` - Add `calculateTotalPageWeight()`
- Interface: Enhance `PerformanceMetrics` with new size properties
- `packages/bots/src/netsuite/report-template.ts` - Display total page weight

**Priority**: P1 (High)
**Effort**: 2 hours
**Note**: May increase audit time due to parallel requests

---

### 6. ✅ **ISSUE**: Incomplete JSON-LD Schema Extraction
**Problem**: Only extracting first `<script type="application/ld+json">` tag, missing additional schemas

**Current Behavior**: Likely using `html.match()` which only finds first match
**Expected**: Extract ALL `<script type="application/ld+json">` blocks

**Solution**:
- Update schema extraction to use `matchAll()` or regex exec loop
- Parse each JSON-LD block separately
- Combine into array: `schemas: Array<{type: string, data: object}>`
- Display each schema separately in report
- For products with multiple schemas, validate ALL of them
- Cross-reference with validator.schema.org recommendations

**Current Implementation to Fix**:
```typescript
// WRONG - only finds first match
const schema = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/i);

// CORRECT - finds all matches
const schemaRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gi;
let match;
const schemas = [];
while ((match = schemaRegex.exec(html)) !== null) {
  try {
    const data = JSON.parse(match[1]);
    schemas.push(data);
  } catch (e) {
    // Invalid JSON, skip
  }
}
```

**Files to Modify**:
- `packages/bots/src/netsuite/netsuite.bot.ts` - Update prompt to extract ALL schemas
- `packages/bots/src/netsuite/report-template.ts` - Display multiple schemas per page
- Interface: Change `currentSchema: any` to `schemas: Array<{@type: string, data: object}>`

**Priority**: P0 (Critical)
**Effort**: 1.5 hours

---

### 7. ✅ **ISSUE**: HTML Report Too Large and Unmanageable
**Problem**: 72KB HTML file with all pages in single scroll, difficult to navigate

**Solution**: Implement Tabbed Interface
- Add tab navigation: **Home** | **Categories** | **Products** | **Competitive** | **Roadmap**
- Use CSS-only tabs (no JavaScript required)
- Structure:
  - **Home Tab**: Homepage audit only
  - **Categories Tab**: All 3 category audits
  - **Products Tab**: All 3 product audits
  - **Competitive Tab**: Competitive analysis
  - **Roadmap Tab**: Priority roadmap
- Default to "Home" tab on load
- Maintain print-friendly layout (all tabs visible when printed)

**Implementation**:
```html
<!-- Tab Navigation -->
<div class="tabs">
  <input type="radio" id="tab-home" name="tabs" checked>
  <label for="tab-home">Home</label>

  <input type="radio" id="tab-categories" name="tabs">
  <label for="tab-categories">Categories (3)</label>

  <input type="radio" id="tab-products" name="tabs">
  <label for="tab-products">Products (3)</label>

  <input type="radio" id="tab-competitive" name="tabs">
  <label for="tab-competitive">Competitive</label>

  <input type="radio" id="tab-roadmap" name="tabs">
  <label for="tab-roadmap">Roadmap</label>
</div>

<!-- Tab Content -->
<div class="tab-content">
  <div class="tab-pane" id="content-home">...</div>
  <div class="tab-pane" id="content-categories">...</div>
  <div class="tab-pane" id="content-products">...</div>
  <div class="tab-pane" id="content-competitive">...</div>
  <div class="tab-pane" id="content-roadmap">...</div>
</div>
```

**CSS (No JavaScript Required)**:
```css
.tabs input[type="radio"] { display: none; }
.tabs label { cursor: pointer; padding: 12px 24px; ... }
.tabs input[type="radio"]:checked + label { background: active-color; }

.tab-pane { display: none; }
#tab-home:checked ~ .tab-content #content-home { display: block; }
#tab-categories:checked ~ .tab-content #content-categories { display: block; }
/* etc */
```

**Files to Modify**:
- `packages/bots/src/netsuite/report-template.ts` - Add tab navigation + restructure sections
- Add new CSS for tabs (`.tabs`, `.tab-pane`, radio button styling)

**Priority**: P1 (High)
**Effort**: 2 hours

---

### 8. ✅ **ISSUE**: File Sharing via URL Instead of Slack Upload
**Problem**: User wants report shared as Slack message/upload, not via file path

**Current**: Bot includes `REPORT_FILE_PATH: /path/to/file.html` which triggers upload
**Expected**: Report should already be uploaded to Slack thread

**Note**: This should already be working via `task-completion-handler.ts`. Need to verify:
1. REPORT_FILE_PATH marker is correctly formatted
2. TaskCompletionHandler.handleFileUploadIfPresent() is detecting marker
3. NotificationService.uploadFile() is successfully uploading
4. File appears in Slack thread

**Possible Issues**:
- File path is relative instead of absolute
- File permissions prevent read
- Slack API error during upload
- Upload succeeds but user doesn't see it

**Solution**:
- Add logging to track upload flow
- Verify absolute path is used
- Add retry logic if upload fails
- Include upload confirmation message in bot response

**Files to Check**:
- `packages/cloud/src/gateway/handlers/task-completion-handler.ts` - Verify upload logic
- `packages/cloud/src/services/notification.service.ts` - Check uploadFile() implementation
- Add error logging if upload fails

**Priority**: P2 (Medium) - May already be working
**Effort**: 1 hour (investigation + fixes)

---

## 📊 Master Plan Summary

### Phase 1: Critical Fixes (P0) — Immediate
**Estimated Time**: 6-8 hours

1. ✅ Fix incomplete JSON-LD extraction (1.5h)
2. ✅ Fix false positive alt tag issues (0.5h)
3. ✅ Add missing alt tag image details with HTML tags (1h)
4. ✅ Expand Schema.org e-commerce element coverage (3h + 0.5h research)

**Deliverable**: Accurate, comprehensive schema analysis with no false positives

---

### Phase 2: High-Priority Enhancements (P1) — Next
**Estimated Time**: 5-6 hours

5. ✅ Add crawled URLs table (1h)
6. ✅ Calculate total SPA page weight (HTML+JS+CSS) (2h)
7. ✅ Implement tabbed report interface (2h)

**Deliverable**: User-friendly, accurate performance metrics and navigation

---

### Phase 3: Polish & UX (P2) — Final
**Estimated Time**: 1-2 hours

8. ✅ Verify/fix Slack file upload flow (1h)

**Deliverable**: Seamless Slack integration

---

## 🎯 Total Effort Estimate

**Total Time**: 12-16 hours across 3 phases
**Recommended Approach**: Implement phases sequentially, test after each phase

---

## 📋 Detailed Task Breakdown

### Task 1: Fix JSON-LD Extraction (P0 - Critical)
**File**: `packages/bots/src/netsuite/netsuite.bot.ts`

**Changes**:
```typescript
// Update bot prompt to extract ALL schemas
"Extract ALL <script type='application/ld+json'> blocks (not just the first one)
For each schema found:
  - Parse JSON
  - Identify @type
  - Validate completeness
  - Report missing properties

Store as: schemas: Array<{@type: string, data: object, missingFields: string[]}>"
```

**File**: `packages/bots/src/netsuite/report-template.ts`

**Changes**:
- Update interface: `schemas?: Array<{type: string, data: any}>` instead of `currentSchema?: any`
- Update report section to loop through all schemas
- Display each schema separately with its own missing fields analysis

---

### Task 2: Fix Alt Tag False Positives (P0 - Critical)
**File**: `packages/netsuite/src/services/seo/seo-service.ts`

**Current Code**:
```typescript
extractImages(html: string): ImageAnalysis {
  const images: ImageAudit[] = [];
  const imgRegex = /<img\s+([^>]+)>/gi;
  // ... rest of implementation
}
```

**Verification Needed**:
- Ensure regex only matches `<img>` tags, not `<link>` or other tags
- Add explicit filter to exclude non-image tags
- Test with actual HTML containing prefetch links

**Add**:
```typescript
// Explicitly skip if tag doesn't start with <img
if (!match[0].toLowerCase().startsWith('<img')) continue;
```

---

### Task 3: Add Image HTML Tags (P0 - Critical)
**File**: `packages/netsuite/src/services/seo/seo-service.ts`

**Enhance**:
```typescript
interface ImageIssue {
  src: string;
  issue: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  htmlTag: string;  // NEW: Full HTML tag for display
}

// In extractImages()
images.push({
  src,
  alt,
  hasAlt,
  hasWidth,
  hasHeight,
  isLazyLoaded,
  severity,
});

// Also track issues separately
if (!hasAlt) {
  const htmlTag = match[0].slice(0, 200); // First 200 chars of tag
  issues.push({
    src,
    issue: 'Missing alt attribute',
    severity: 'critical',
    htmlTag: escapeHtml(htmlTag)
  });
}
```

**File**: `packages/bots/src/netsuite/report-template.ts`

**Update** `getImageAuditSection()`:
```typescript
<p><strong>Images Missing Alt Tags:</strong></p>
<ul class="issue-list">
  ${images.issues.filter(i => i.severity === 'critical').slice(0, 20).map(issue => `
    <li>
      <strong>${issue.issue}</strong><br>
      <code>${issue.htmlTag}</code>
    </li>
  `).join('\n')}
  ${images.issues.length > 20 ? `<li>... and ${images.issues.length - 20} more images</li>` : ''}
</ul>
```

---

### Task 4: Expand Schema.org Coverage (P0 - Critical)
**Research Step**: Document all e-commerce schemas

**Create**: `packages/netsuite/src/services/seo/schema-definitions.ts`

```typescript
export const ECOMMERCE_SCHEMAS = {
  homepage: [
    'Organization',
    'WebSite',
    'SearchAction',
    'SiteNavigationElement',
    'ContactPoint',
    'PostalAddress'
  ],
  category: [
    'BreadcrumbList',
    'ItemList',
    'OfferCatalog',
    'CollectionPage'
  ],
  product: [
    'Product',
    'Offer',
    'Brand',
    'ImageObject',
    'AggregateRating',
    'Review',
    'BreadcrumbList',
    'Question',
    'Answer',
    'FAQPage'
  ]
};

export const SCHEMA_PRIORITIES = {
  'Product': 'P0',
  'Offer': 'P0',
  'AggregateRating': 'P1',
  'Review': 'P1',
  'Brand': 'P1',
  'BreadcrumbList': 'P1',
  'ImageObject': 'P2',
  // ... etc
};
```

**Update**: `packages/bots/src/netsuite/netsuite.bot.ts`

Add comprehensive schema checklist to system prompt with priorities.

---

### Task 5: Add Crawled URLs Table (P1 - High)
**File**: `packages/bots/src/netsuite/report-template.ts`

**Add Interface**:
```typescript
interface CrawledUrl {
  url: string;
  type: 'homepage' | 'category' | 'product';
  status: number;
  responseTime: number;
}

interface AuditData {
  // ... existing
  crawledUrls: CrawledUrl[];
}
```

**Add Function**:
```typescript
function getCrawledUrlsSection(data: AuditData): string {
  return `
    <h3>Crawled URLs</h3>
    <table class="summary-table">
      <thead>
        <tr>
          <th>URL</th>
          <th>Type</th>
          <th>Status</th>
          <th>Response Time</th>
        </tr>
      </thead>
      <tbody>
        ${data.crawledUrls.map(url => `
          <tr>
            <td><a href="${url.url}" target="_blank">${url.url}</a></td>
            <td><span class="pill pill-low">${url.type.toUpperCase()}</span></td>
            <td><span class="pill ${url.status === 200 ? 'pill-low' : 'pill-critical'}">${url.status}</span></td>
            <td>${url.responseTime}ms</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}
```

Insert after Executive Summary.

---

### Task 6: Calculate Total SPA Weight (P1 - High)
**File**: `packages/netsuite/src/services/seo/seo-service.ts`

**Add Method**:
```typescript
async calculateTotalPageWeight(html: string, baseUrl: string): Promise<{
  htmlSizeKB: number;
  jsSizeKB: number;
  cssSizeKB: number;
  totalSizeKB: number;
}> {
  const htmlSize = html.length / 1024;

  // Extract script URLs
  const scriptRegex = /<script[^>]+src=["']([^"']+)["']/gi;
  const scriptUrls: string[] = [];
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const src = match[1];
    const absoluteUrl = this.resolveUrl(src, baseUrl);
    scriptUrls.push(absoluteUrl);
  }

  // Extract CSS URLs
  const cssRegex = /<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi;
  const cssUrls: string[] = [];
  while ((match = cssRegex.exec(html)) !== null) {
    const href = match[1];
    const absoluteUrl = this.resolveUrl(href, baseUrl);
    cssUrls.push(absoluteUrl);
  }

  // Parallel HEAD requests to get sizes
  const scriptSizes = await this.fetchResourceSizes(scriptUrls);
  const cssSizes = await this.fetchResourceSizes(cssUrls);

  const jsSizeKB = scriptSizes.reduce((sum, size) => sum + size, 0);
  const cssSizeKB = cssSizes.reduce((sum, size) => sum + size, 0);

  return {
    htmlSizeKB,
    jsSizeKB,
    cssSizeKB,
    totalSizeKB: htmlSizeKB + jsSizeKB + cssSizeKB
  };
}

private async fetchResourceSizes(urls: string[]): Promise<number[]> {
  const sizes = await Promise.all(
    urls.map(async (url) => {
      try {
        const response = await fetch(url, { method: 'HEAD' });
        const contentLength = response.headers.get('content-length');
        return contentLength ? parseInt(contentLength, 10) / 1024 : 0;
      } catch {
        return 0;
      }
    })
  );
  return sizes;
}

private resolveUrl(url: string, baseUrl: string): string {
  if (url.startsWith('http')) return url;
  if (url.startsWith('//')) return 'https:' + url;
  if (url.startsWith('/')) return new URL(baseUrl).origin + url;
  return new URL(url, baseUrl).href;
}
```

---

### Task 7: Implement Tabbed Interface (P1 - High)
**File**: `packages/bots/src/netsuite/report-template.ts`

**Add CSS**:
```css
/* Tabs */
.tabs {
  display: flex;
  border-bottom: 2px solid #e2e8f0;
  margin: 32px 0;
  gap: 4px;
}
.tabs input[type="radio"] {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.tabs label {
  padding: 12px 24px;
  cursor: pointer;
  border-bottom: 3px solid transparent;
  transition: all 0.2s;
  font-weight: 600;
  color: #64748b;
}
.tabs label:hover {
  color: #1e293b;
  background: #f8fafc;
}
.tabs input[type="radio"]:checked + label {
  color: #2563eb;
  border-bottom-color: #2563eb;
}

.tab-pane {
  display: none;
  animation: fadeIn 0.3s;
}
#tab-home:checked ~ .tab-content #content-home,
#tab-categories:checked ~ .tab-content #content-categories,
#tab-products:checked ~ .tab-content #content-products,
#tab-competitive:checked ~ .tab-content #content-competitive,
#tab-roadmap:checked ~ .tab-content #content-roadmap {
  display: block;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@media print {
  .tabs { display: none; }
  .tab-pane { display: block !important; page-break-before: always; }
}
```

**Restructure Report**:
```html
<!-- After Executive Summary -->
<div class="tabs">
  <input type="radio" id="tab-home" name="tabs" checked>
  <label for="tab-home">🏠 Home</label>

  <input type="radio" id="tab-categories" name="tabs">
  <label for="tab-categories">📁 Categories (3)</label>

  <input type="radio" id="tab-products" name="tabs">
  <label for="tab-products">🛍️ Products (3)</label>

  <input type="radio" id="tab-competitive" name="tabs">
  <label for="tab-competitive">🏆 Competitive</label>

  <input type="radio" id="tab-roadmap" name="tabs">
  <label for="tab-roadmap">🗺️ Roadmap</label>
</div>

<div class="tab-content">
  <div class="tab-pane" id="content-home">
    ${getHomepageAudit(data)}
  </div>

  <div class="tab-pane" id="content-categories">
    ${getCategoryAudits(data)}
  </div>

  <div class="tab-pane" id="content-products">
    ${getProductAudits(data)}
  </div>

  <div class="tab-pane" id="content-competitive">
    ${getCompetitiveAnalysis(data)}
  </div>

  <div class="tab-pane" id="content-roadmap">
    ${getRoadmap(data)}
  </div>
</div>
```

---

## ✅ Implementation Checklist

### Phase 1 (P0 - Critical) - Days 1-2
- [ ] Task 1: Fix JSON-LD extraction to capture ALL schemas
- [ ] Task 2: Fix alt tag false positives (filter non-img tags)
- [ ] Task 3: Add HTML tag snippets to image issues
- [ ] Task 4: Research + document e-commerce schemas
- [ ] Task 4: Expand schema coverage in bot prompt
- [ ] Test Phase 1 on real NetSuite site
- [ ] Verify no false positives, all schemas captured

### Phase 2 (P1 - High) - Days 3-4
- [ ] Task 5: Add crawled URLs table to report
- [ ] Task 6: Implement total SPA weight calculation
- [ ] Task 7: Implement tabbed report interface
- [ ] Test Phase 2 on real NetSuite site
- [ ] Verify report is user-friendly and navigable

### Phase 3 (P2 - Medium) - Day 5
- [ ] Task 8: Verify Slack file upload flow
- [ ] Fix any upload issues discovered
- [ ] End-to-end test in Slack
- [ ] Verify customer receives report as expected

---

## 🎯 Success Criteria

After implementation, the audit should:
1. ✅ Extract ALL JSON-LD schemas (not just first)
2. ✅ Cover ALL e-commerce Schema.org types
3. ✅ Show exact images missing alt tags with HTML markup
4. ✅ Have NO false positives for alt tag checks
5. ✅ Calculate accurate SPA page weight (HTML+JS+CSS)
6. ✅ Display crawled URLs in organized table
7. ✅ Use tabbed interface for easy navigation
8. ✅ Upload automatically to Slack thread

**Expected Result**: Production-grade, comprehensive SEO audits ready for immediate customer delivery.

---

**Total Estimated Time**: 12-16 hours
**Recommended Timeline**: 5 days (2-3 hours/day)
**Priority Order**: P0 → P1 → P2 (phases sequentially)

