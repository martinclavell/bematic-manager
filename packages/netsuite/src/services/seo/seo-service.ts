import type { NetSuiteClient } from '../../core/client/netsuite-client.js';
import { NetSuiteValidationError } from '../../errors/netsuite-error.js';

export interface SEODebugOptions {
  /** Enable SEO debug mode */
  debug?: boolean;
  /** Preview timestamp */
  preview?: number;
  /** Disable JavaScript cache */
  noJsCache?: boolean;
  /** Custom query parameters */
  customParams?: Record<string, string>;
}

export interface ImageAudit {
  src: string;
  alt: string;
  hasAlt: boolean;
  hasWidth: boolean;
  hasHeight: boolean;
  isLazyLoaded: boolean;
  severity: 'critical' | 'high' | 'medium' | 'low';
  htmlTag: string;  // Full HTML tag for debugging
}

export interface ImageAnalysis {
  images: ImageAudit[];
  totalImages: number;
  missingAlt: number;
  missingDimensions: number;
  lazyLoaded: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  issues: Array<{
    src: string;
    issue: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    htmlTag: string;
  }>;
}

export interface Heading {
  level: number;
  text: string;
  isEmpty: boolean;
}

export interface HeadingIssue {
  type: 'multiple_h1' | 'no_h1' | 'empty_heading' | 'skipped_level';
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  headings?: Heading[];
}

export interface HeadingAnalysis {
  headings: Heading[];
  h1Count: number;
  hasMultipleH1: boolean;
  hasNoH1: boolean;
  hierarchyIssues: HeadingIssue[];
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface Link {
  href: string;
  text: string;
  isInternal: boolean;
  isExternal: boolean;
  isNofollow: boolean;
  hasAnchorText: boolean;
  isHash: boolean;
}

export interface LinkAnalysis {
  links: Link[];
  totalLinks: number;
  internalLinks: number;
  externalLinks: number;
  nofollowLinks: number;
  emptyAnchors: number;
  hashLinks: number;
}

export interface TitleAnalysis {
  text: string;
  length: number;
  issues: string[];
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface DescriptionAnalysis {
  text: string;
  length: number;
  issues: string[];
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface CanonicalAnalysis {
  url: string | null;
  present: boolean;
  isValid: boolean;
}

export interface RobotsAnalysis {
  content: string;
  isNoindex: boolean;
  isNofollow: boolean;
  hasIssues: boolean;
}

export interface ViewportAnalysis {
  content: string;
  isMobileFriendly: boolean;
  hasViewport: boolean;
}

export interface OpenGraphAnalysis {
  hasCompleteOG: boolean;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  ogUrl: string | null;
  ogType: string | null;
  missingTags: string[];
}

export interface TwitterCardAnalysis {
  hasTwitterCard: boolean;
  twitterCard: string | null;
  twitterTitle: string | null;
  twitterDescription: string | null;
  twitterImage: string | null;
  missingTags: string[];
}

export interface ComprehensiveSEOAnalysis {
  title: TitleAnalysis;
  description: DescriptionAnalysis;
  canonical: CanonicalAnalysis;
  robots: RobotsAnalysis;
  viewport: ViewportAnalysis;
  openGraph: OpenGraphAnalysis;
  twitterCard: TwitterCardAnalysis;
  hasStructuredData: boolean;
  hasLangAttribute: boolean;
  langValue: string | null;
  metaTags: Record<string, string>;
}

export interface PerformanceMetrics {
  htmlSize: number;
  htmlSizeKB: string;
  jsSizeKB: number;
  cssSizeKB: number;
  totalPageWeightKB: number;
  responseTimeMs: number;
  imageCount: number;
  scriptCount: number;
  stylesheetCount: number;
  isCompressed: boolean;
  contentEncoding: string | null;
  serverHeader: string | null;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

export interface PagePerformance {
  url: string;
  html: string;
  contentLength: number;
  responseTime: number;
  performance: PerformanceMetrics;
}

/**
 * Service for NetSuite SuiteCommerce SEO debugging and comprehensive analysis
 */
export class NetSuiteSEOService {
  constructor(private readonly client: NetSuiteClient) {}

  /**
   * Build SEO debug URL for SuiteCommerce page
   */
  buildDebugUrl(baseUrl: string, options?: SEODebugOptions): string {
    // Remove protocol and www if present
    let cleanUrl = baseUrl.replace(/^https?:\/\//, '').replace(/^www\./, '');

    // Remove trailing slash
    cleanUrl = cleanUrl.replace(/\/$/, '');

    // Build URL with debug parameters
    const url = new URL(`https://${cleanUrl}`);

    if (options?.debug !== false) {
      url.searchParams.set('seodebug', 'T');
    }

    if (options?.preview !== undefined) {
      url.searchParams.set('preview', options.preview.toString());
    } else {
      url.searchParams.set('preview', Date.now().toString());
    }

    if (options?.noJsCache !== false) {
      url.searchParams.set('seonojscache', 'T');
    }

    // Add custom parameters
    if (options?.customParams) {
      for (const [key, value] of Object.entries(options.customParams)) {
        url.searchParams.set(key, value);
      }
    }

    return url.toString();
  }

  /**
   * Fetch SEO debug page with comprehensive SPA performance metrics
   */
  async fetchDebugPage(baseUrl: string, options?: SEODebugOptions): Promise<PagePerformance> {
    const debugUrl = this.buildDebugUrl(baseUrl, options);
    const startTime = Date.now();

    const response = await fetch(debugUrl);
    const responseTime = Date.now() - startTime;

    if (!response.ok) {
      throw new NetSuiteValidationError(
        `Failed to fetch SEO debug page: ${response.status} ${response.statusText}`,
      );
    }

    const html = await response.text();
    const contentLength = html.length;

    // Calculate total page weight for SPA
    const pageWeight = await this.calculateTotalPageWeight(html, debugUrl);

    // Analyze performance with SPA metrics
    const performance = this.analyzePerformance(response, html, responseTime);

    // Update performance with SPA page weight data
    performance.jsSizeKB = pageWeight.jsSizeKB;
    performance.cssSizeKB = pageWeight.cssSizeKB;
    performance.totalPageWeightKB = pageWeight.totalSizeKB;

    // Recalculate grade based on total page weight
    performance.grade = this.calculateSPAGrade(responseTime, pageWeight.totalSizeKB);

    return {
      url: debugUrl,
      html,
      contentLength,
      responseTime,
      performance,
    };
  }

  /**
   * Calculate performance grade for SPA based on total page weight
   */
  private calculateSPAGrade(responseTime: number, totalSizeKB: number): 'A' | 'B' | 'C' | 'D' | 'F' {
    // SPA grading thresholds (more lenient than HTML-only)
    if (responseTime < 1000 && totalSizeKB < 500) {
      return 'A';
    } else if (responseTime < 2000 && totalSizeKB < 1000) {
      return 'B';
    } else if (responseTime < 3000 && totalSizeKB < 1500) {
      return 'C';
    } else if (responseTime < 5000 && totalSizeKB < 2000) {
      return 'D';
    } else {
      return 'F';
    }
  }

  /**
   * Extract and analyze images from HTML
   */
  extractImages(html: string): ImageAnalysis {
    const images: ImageAudit[] = [];
    const imgRegex = /<img\s+([^>]+)>/gi;
    let match;

    while ((match = imgRegex.exec(html)) !== null) {
      const fullTag = match[0]; // Full <img> tag
      const attrs = match[1];
      if (!attrs) continue;

      // Only process <img> tags - this prevents false positives from <link> tags
      if (!fullTag.toLowerCase().startsWith('<img')) {
        continue;
      }

      const src = attrs.match(/src=["']([^"']+)["']/i)?.[1] || '';
      const alt = attrs.match(/alt=["']([^"']*)["']/i)?.[1] || '';
      const width = attrs.match(/width=["']?([^"'\s>]+)["']?/i)?.[1];
      const height = attrs.match(/height=["']?([^"'\s>]+)["']?/i)?.[1];
      const loading = attrs.match(/loading=["']([^"']+)["']/i)?.[1];

      const hasAlt = alt.trim().length > 0;
      const hasWidth = !!width;
      const hasHeight = !!height;
      const isLazyLoaded = loading === 'lazy';

      // Determine severity
      let severity: 'critical' | 'high' | 'medium' | 'low';
      if (!hasAlt) {
        severity = 'critical'; // Missing alt is critical for accessibility + SEO
      } else if (!hasWidth || !hasHeight) {
        severity = 'medium'; // Missing dimensions can cause layout shift
      } else {
        severity = 'low'; // All good
      }

      images.push({
        src,
        alt,
        hasAlt,
        hasWidth,
        hasHeight,
        isLazyLoaded,
        severity,
        // Add the full HTML tag for debugging (limited to first 200 characters)
        htmlTag: fullTag.length > 200 ? fullTag.substring(0, 200) + '...' : fullTag,
      });
    }

    const missingAlt = images.filter(img => !img.hasAlt).length;
    const missingDimensions = images.filter(img => !img.hasWidth || !img.hasHeight).length;
    const lazyLoaded = images.filter(img => img.isLazyLoaded).length;

    // Overall severity
    let overallSeverity: 'critical' | 'high' | 'medium' | 'low';
    if (missingAlt > 0) {
      overallSeverity = 'critical';
    } else if (missingDimensions > images.length / 2) {
      overallSeverity = 'high';
    } else if (missingDimensions > 0) {
      overallSeverity = 'medium';
    } else {
      overallSeverity = 'low';
    }

    // Create issues array for reporting
    const issues = images
      .filter(img => !img.hasAlt || !img.hasWidth || !img.hasHeight)
      .map(img => ({
        src: img.src,
        htmlTag: img.htmlTag,
        severity: img.severity,
        issue: !img.hasAlt
          ? 'Missing alt attribute - critical for accessibility and SEO'
          : 'Missing width or height attributes - may cause layout shift'
      }));

    return {
      images,
      totalImages: images.length,
      missingAlt,
      missingDimensions,
      lazyLoaded,
      severity: overallSeverity,
      issues,
    };
  }

  /**
   * Extract and analyze heading structure from HTML
   */
  extractHeadings(html: string): HeadingAnalysis {
    const headings: Heading[] = [];
    const headingRegex = /<h([1-6])[^>]*>(.*?)<\/h[1-6]>/gi;
    let match;

    while ((match = headingRegex.exec(html)) !== null) {
      const level = parseInt(match[1]!, 10);
      const rawText = match[2]!;

      // Strip HTML tags from text content
      const text = rawText.replace(/<[^>]+>/g, '').trim();

      headings.push({
        level,
        text,
        isEmpty: text.length === 0,
      });
    }

    const h1Count = headings.filter(h => h.level === 1).length;
    const hasMultipleH1 = h1Count > 1;
    const hasNoH1 = h1Count === 0;

    // Detect hierarchy issues (skipped levels)
    const hierarchyIssues: HeadingIssue[] = [];

    // Check for multiple H1s
    if (hasMultipleH1) {
      const h1Headings = headings.filter(h => h.level === 1);
      hierarchyIssues.push({
        type: 'multiple_h1',
        severity: 'critical',
        description: `Page has ${h1Count} H1 tags. Each page should have exactly ONE H1.`,
        headings: h1Headings,
      });
    }

    // Check for no H1
    if (hasNoH1) {
      hierarchyIssues.push({
        type: 'no_h1',
        severity: 'critical',
        description: 'Page is missing an H1 tag. Every page should have exactly one H1 that describes the main topic.',
      });
    }

    // Check for empty headings
    const emptyHeadings = headings.filter(h => h.isEmpty);
    if (emptyHeadings.length > 0) {
      hierarchyIssues.push({
        type: 'empty_heading',
        severity: 'high',
        description: `Found ${emptyHeadings.length} empty heading(s). All headings should have descriptive text.`,
        headings: emptyHeadings,
      });
    }

    // Check for skipped levels (e.g., H2 → H4)
    for (let i = 1; i < headings.length; i++) {
      const prev = headings[i - 1]!;
      const curr = headings[i]!;

      if (curr.level > prev.level + 1) {
        hierarchyIssues.push({
          type: 'skipped_level',
          severity: 'medium',
          description: `Heading hierarchy skips from H${prev.level} to H${curr.level}. Don't skip levels (use H${prev.level + 1} instead).`,
          headings: [prev, curr],
        });
      }
    }

    // Overall severity
    let overallSeverity: 'critical' | 'high' | 'medium' | 'low';
    if (hasNoH1 || hasMultipleH1) {
      overallSeverity = 'critical';
    } else if (hierarchyIssues.some(issue => issue.severity === 'high')) {
      overallSeverity = 'high';
    } else if (hierarchyIssues.length > 0) {
      overallSeverity = 'medium';
    } else {
      overallSeverity = 'low';
    }

    return {
      headings,
      h1Count,
      hasMultipleH1,
      hasNoH1,
      hierarchyIssues,
      severity: overallSeverity,
    };
  }

  /**
   * Extract and analyze links from HTML
   */
  extractLinks(html: string, baseUrl: string): LinkAnalysis {
    const links: Link[] = [];
    const linkRegex = /<a\s+([^>]+)>(.?)<\/a>/gi;
    let match;

    // Parse base URL for domain comparison
    let baseDomain = '';
    try {
      baseDomain = new URL(baseUrl).hostname.replace(/^www\./, '');
    } catch {
      // Invalid base URL, treat all as external
    }

    while ((match = linkRegex.exec(html)) !== null) {
      const attrs = match[1];
      const innerHtml = match[2] || '';

      if (!attrs) continue;

      const href = attrs.match(/href=["']([^"']+)["']/i)?.[1];
      const rel = attrs.match(/rel=["']([^"']+)["']/i)?.[1];

      if (!href) continue;

      // Extract text (strip HTML tags)
      const text = innerHtml.replace(/<[^>]+>/g, '').trim();

      // Determine if internal or external
      let isInternal = false;
      let isHash = false;

      if (href.startsWith('#')) {
        isHash = true;
        isInternal = true;
      } else if (href.startsWith('/')) {
        isInternal = true;
      } else if (href.startsWith('http://') || href.startsWith('https://')) {
        try {
          const linkDomain = new URL(href).hostname.replace(/^www\./, '');
          isInternal = linkDomain === baseDomain;
        } catch {
          // Invalid URL, treat as external
          isInternal = false;
        }
      } else {
        // Relative URL
        isInternal = true;
      }

      const isNofollow = rel?.includes('nofollow') || false;
      const hasAnchorText = text.length > 0;

      links.push({
        href,
        text,
        isInternal,
        isExternal: !isInternal,
        isNofollow,
        hasAnchorText,
        isHash,
      });
    }

    return {
      links,
      totalLinks: links.length,
      internalLinks: links.filter(l => l.isInternal).length,
      externalLinks: links.filter(l => l.isExternal).length,
      nofollowLinks: links.filter(l => l.isNofollow).length,
      emptyAnchors: links.filter(l => !l.hasAnchorText).length,
      hashLinks: links.filter(l => l.isHash).length,
    };
  }

  /**
   * Extract meta tags from HTML
   */
  extractMetaTags(html: string): Record<string, string> {
    const metaTags: Record<string, string> = {};
    const metaRegex = /<meta\s+([^>]+)>/gi;
    let match;

    while ((match = metaRegex.exec(html)) !== null) {
      const attrs = match[1];
      if (!attrs) continue;

      const nameMatch = attrs.match(/name=["']([^"']+)["']/i);
      const propertyMatch = attrs.match(/property=["']([^"']+)["']/i);
      const contentMatch = attrs.match(/content=["']([^"']+)["']/i);

      const key = nameMatch?.[1] || propertyMatch?.[1];
      const value = contentMatch?.[1];

      if (key && value) {
        metaTags[key] = value;
      }
    }

    return metaTags;
  }

  /**
   * Comprehensive SEO analysis with detailed meta tag validation
   */
  analyzeSEO(html: string): ComprehensiveSEOAnalysis {
    const metaTags = this.extractMetaTags(html);

    // Title analysis
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const titleText = titleMatch?.[1]?.trim() || '';
    const titleLength = titleText.length;
    const titleIssues: string[] = [];
    let titleSeverity: 'critical' | 'high' | 'medium' | 'low' = 'low';

    if (titleLength === 0) {
      titleIssues.push('Missing title tag');
      titleSeverity = 'critical';
    } else if (titleLength < 30) {
      titleIssues.push('Title too short (optimal: 50-60 characters)');
      titleSeverity = 'high';
    } else if (titleLength > 60) {
      titleIssues.push('Title too long, will be truncated in SERPs (optimal: 50-60 characters)');
      titleSeverity = 'medium';
    }

    // Description analysis
    const description = metaTags['description'] || '';
    const descLength = description.length;
    const descIssues: string[] = [];
    let descSeverity: 'critical' | 'high' | 'medium' | 'low' = 'low';

    if (descLength === 0) {
      descIssues.push('Missing meta description');
      descSeverity = 'critical';
    } else if (descLength < 120) {
      descIssues.push('Description too short (optimal: 150-160 characters)');
      descSeverity = 'high';
    } else if (descLength > 160) {
      descIssues.push('Description too long, will be truncated in SERPs (optimal: 150-160 characters)');
      descSeverity = 'medium';
    }

    // Canonical URL
    const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
    const canonicalUrl = canonicalMatch?.[1] || null;
    const hasCanonical = !!canonicalUrl;
    let canonicalValid = false;
    if (canonicalUrl) {
      try {
        new URL(canonicalUrl);
        canonicalValid = true;
      } catch {
        canonicalValid = false;
      }
    }

    // Robots meta
    const robots = metaTags['robots'] || '';
    const isNoindex = robots.toLowerCase().includes('noindex');
    const isNofollow = robots.toLowerCase().includes('nofollow');
    const robotsHasIssues = isNoindex; // Noindex is often unintentional

    // Viewport
    const viewport = metaTags['viewport'] || '';
    const hasViewport = viewport.length > 0;
    const isMobileFriendly = viewport.includes('width=device-width');

    // Open Graph
    const ogTitle = metaTags['og:title'] || null;
    const ogDescription = metaTags['og:description'] || null;
    const ogImage = metaTags['og:image'] || null;
    const ogUrl = metaTags['og:url'] || null;
    const ogType = metaTags['og:type'] || null;

    const requiredOGTags = ['og:title', 'og:description', 'og:image', 'og:url'];
    const missingOGTags = requiredOGTags.filter(tag => !metaTags[tag]);
    const hasCompleteOG = missingOGTags.length === 0;

    // Twitter Card
    const twitterCard = metaTags['twitter:card'] || null;
    const twitterTitle = metaTags['twitter:title'] || null;
    const twitterDescription = metaTags['twitter:description'] || null;
    const twitterImage = metaTags['twitter:image'] || null;

    const requiredTwitterTags = ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image'];
    const missingTwitterTags = requiredTwitterTags.filter(tag => !metaTags[tag]);
    const hasTwitterCard = missingTwitterTags.length === 0;

    // Structured data
    const hasStructuredData = /<script[^>]+type=["']application\/ld\+json["'][^>]*>/i.test(html);

    // Language attribute
    const langMatch = html.match(/<html[^>]+lang=["']([^"']+)["']/i);
    const langValue = langMatch?.[1] || null;
    const hasLangAttribute = !!langValue;

    return {
      title: {
        text: titleText,
        length: titleLength,
        issues: titleIssues,
        severity: titleSeverity,
      },
      description: {
        text: description,
        length: descLength,
        issues: descIssues,
        severity: descSeverity,
      },
      canonical: {
        url: canonicalUrl,
        present: hasCanonical,
        isValid: canonicalValid,
      },
      robots: {
        content: robots,
        isNoindex,
        isNofollow,
        hasIssues: robotsHasIssues,
      },
      viewport: {
        content: viewport,
        isMobileFriendly,
        hasViewport,
      },
      openGraph: {
        hasCompleteOG,
        ogTitle,
        ogDescription,
        ogImage,
        ogUrl,
        ogType,
        missingTags: missingOGTags,
      },
      twitterCard: {
        hasTwitterCard,
        twitterCard,
        twitterTitle,
        twitterDescription,
        twitterImage,
        missingTags: missingTwitterTags,
      },
      hasStructuredData,
      hasLangAttribute,
      langValue,
      metaTags,
    };
  }

  /**
   * Calculate total page weight for SPA (HTML + JS + CSS)
   */
  async calculateTotalPageWeight(html: string, baseUrl: string): Promise<{
    htmlSizeKB: number;
    jsSizeKB: number;
    cssSizeKB: number;
    totalSizeKB: number;
  }> {
    const htmlSizeKB = html.length / 1024;

    // Extract script URLs
    const scriptUrls: string[] = [];
    const scriptRegex = /<script[^>]+src=["']([^"']+)["']/gi;
    let scriptMatch;
    while ((scriptMatch = scriptRegex.exec(html)) !== null) {
      if (scriptMatch[1]) {
        scriptUrls.push(this.resolveUrl(scriptMatch[1], baseUrl));
      }
    }

    // Extract CSS URLs
    const cssUrls: string[] = [];
    const cssRegex = /<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi;
    let cssMatch;
    while ((cssMatch = cssRegex.exec(html)) !== null) {
      if (cssMatch[1]) {
        cssUrls.push(this.resolveUrl(cssMatch[1], baseUrl));
      }
    }

    // Fetch resource sizes in parallel
    const [jsSizes, cssSizes] = await Promise.all([
      this.fetchResourceSizes(scriptUrls),
      this.fetchResourceSizes(cssUrls),
    ]);

    const jsSizeKB = jsSizes.reduce((sum, size) => sum + size, 0);
    const cssSizeKB = cssSizes.reduce((sum, size) => sum + size, 0);
    const totalSizeKB = htmlSizeKB + jsSizeKB + cssSizeKB;

    return {
      htmlSizeKB,
      jsSizeKB,
      cssSizeKB,
      totalSizeKB,
    };
  }

  /**
   * Fetch resource sizes using HEAD requests
   */
  private async fetchResourceSizes(urls: string[]): Promise<number[]> {
    const fetchPromises = urls.map(async (url) => {
      try {
        const response = await fetch(url, { method: 'HEAD' });
        const contentLength = response.headers.get('content-length');
        if (contentLength) {
          return parseInt(contentLength, 10) / 1024; // Convert to KB
        }
        return 0;
      } catch {
        // Return 0 if fetch fails (CORS, network error, etc.)
        return 0;
      }
    });

    return Promise.all(fetchPromises);
  }

  /**
   * Resolve relative URLs to absolute URLs
   */
  private resolveUrl(url: string, baseUrl: string): string {
    // Already absolute URL
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }

    // Protocol-relative URL
    if (url.startsWith('//')) {
      const protocol = baseUrl.startsWith('https://') ? 'https:' : 'http:';
      return protocol + url;
    }

    try {
      const base = new URL(baseUrl);

      // Root-relative URL
      if (url.startsWith('/')) {
        return `${base.protocol}//${base.host}${url}`;
      }

      // Relative URL
      return new URL(url, baseUrl).toString();
    } catch {
      // If URL construction fails, return the original URL
      return url;
    }
  }

  /**
   * Analyze page performance metrics
   */
  analyzePerformance(response: Response, html: string, responseTime: number): PerformanceMetrics {
    const htmlSize = html.length;
    const htmlSizeKB = (htmlSize / 1024).toFixed(2);

    // Count resources in HTML
    const imageCount = (html.match(/<img/gi) || []).length;
    const scriptCount = (html.match(/<script/gi) || []).length;
    const stylesheetCount = (html.match(/<link[^>]+rel=["']stylesheet["']/gi) || []).length;

    // Check compression
    const contentEncoding = response.headers.get('content-encoding');
    const isCompressed = !!(contentEncoding && (contentEncoding.includes('gzip') || contentEncoding.includes('br')));

    // Server header
    const serverHeader = response.headers.get('server');

    // Calculate grade based on response time and HTML size (legacy method)
    // Note: For full SPA analysis, use calculateTotalPageWeight() method
    let grade: 'A' | 'B' | 'C' | 'D' | 'F';
    const sizeKB = parseFloat(htmlSizeKB);

    if (responseTime < 500 && sizeKB < 100) {
      grade = 'A';
    } else if (responseTime < 1000 && sizeKB < 150) {
      grade = 'B';
    } else if (responseTime < 2000 && sizeKB < 200) {
      grade = 'C';
    } else if (responseTime < 3000 && sizeKB < 300) {
      grade = 'D';
    } else {
      grade = 'F';
    }

    return {
      htmlSize,
      htmlSizeKB,
      jsSizeKB: 0, // Legacy method - use calculateTotalPageWeight() for actual JS size
      cssSizeKB: 0, // Legacy method - use calculateTotalPageWeight() for actual CSS size
      totalPageWeightKB: sizeKB, // Legacy method - only HTML size
      responseTimeMs: responseTime,
      imageCount,
      scriptCount,
      stylesheetCount,
      isCompressed,
      contentEncoding,
      serverHeader,
      grade,
    };
  }

  /**
   * @deprecated Use analyzeSEO() instead for comprehensive analysis
   */
  checkBasicSEO(html: string): {
    hasTitle: boolean;
    hasDescription: boolean;
    hasKeywords: boolean;
    hasOgTags: boolean;
    hasStructuredData: boolean;
    metaTags: Record<string, string>;
  } {
    const metaTags = this.extractMetaTags(html);

    return {
      hasTitle: /<title>([^<]+)<\/title>/i.test(html),
      hasDescription: !!metaTags['description'],
      hasKeywords: !!metaTags['keywords'],
      hasOgTags: Object.keys(metaTags).some((key) => key.startsWith('og:')),
      hasStructuredData: /<script[^>]+type=["']application\/ld\+json["'][^>]*>/i.test(html),
      metaTags,
    };
  }
}
