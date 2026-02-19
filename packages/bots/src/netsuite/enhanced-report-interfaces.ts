/**
 * Enhanced interfaces for comprehensive SEO audit reports
 * Includes: images, headings, links, meta tags, performance
 */

export interface ImageAuditData {
  totalImages: number;
  missingAlt: number;
  missingDimensions: number;
  lazyLoaded: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  issues: ImageIssue[];
}

export interface ImageIssue {
  src: string;
  issue: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  htmlTag: string;  // Full HTML tag (first 200 chars) for debugging
}

export interface HeadingAuditData {
  h1Count: number;
  totalHeadings: number;
  hasMultipleH1: boolean;
  hasNoH1: boolean;
  hierarchyIssues: string[];
  severity: 'critical' | 'high' | 'medium' | 'low';
  headings: { level: number; text: string }[];
}

export interface LinkAuditData {
  totalLinks: number;
  internalLinks: number;
  externalLinks: number;
  nofollowLinks: number;
  emptyAnchors: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface MetaTagsAuditData {
  title: {
    text: string;
    length: number;
    issues: string[];
    severity: 'critical' | 'high' | 'medium' | 'low';
  };
  description: {
    text: string;
    length: number;
    issues: string[];
    severity: 'critical' | 'high' | 'medium' | 'low';
  };
  canonical: {
    url: string | null;
    present: boolean;
    isValid: boolean;
  };
  viewport: {
    present: boolean;
    isMobileFriendly: boolean;
  };
  openGraph: {
    hasCompleteOG: boolean;
    missingTags: string[];
  };
  twitterCard: {
    hasTwitterCard: boolean;
    missingTags: string[];
  };
  robots: {
    content: string;
    isNoindex: boolean;
    issues: string[];
  };
}

export interface PerformanceAuditData {
  responseTimeMs: number;
  htmlSizeKB: string;
  jsSizeKB: number;
  cssSizeKB: number;
  totalPageWeightKB: number;
  imageCount: number;
  scriptCount: number;
  stylesheetCount: number;
  isCompressed: boolean;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

export interface SchemaData {
  type: string;
  data: any;
  hasValidJson: boolean;
  parseError?: string;
}

export interface CrawledUrl {
  url: string;
  type: 'homepage' | 'category' | 'product' | 'other';
  status: number;
  responseTime: number;
}

/** Enhanced PageAudit with comprehensive SEO data */
export interface EnhancedPageAudit {
  type: 'homepage' | 'category' | 'product';
  url: string;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  
  // Enhanced schema analysis - supports multiple JSON-LD blocks
  schemas?: SchemaData[];
  currentSchema?: any; // Deprecated - kept for backward compatibility
  missingFields?: Array<{
    field: string;
    priority: 'P0' | 'P1' | 'P2' | 'P3';
    impact: string;
    details: string;
  }>;

  // NEW: Comprehensive SEO audits
  images?: ImageAuditData;
  headings?: HeadingAuditData;
  links?: LinkAuditData;
  metaTags?: MetaTagsAuditData;
  performance?: PerformanceAuditData;

  recommendations: string;
}

