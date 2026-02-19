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

/**
 * Service for NetSuite SuiteCommerce SEO debugging
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
   * Fetch SEO debug page
   */
  async fetchDebugPage(baseUrl: string, options?: SEODebugOptions): Promise<{
    url: string;
    html: string;
    contentLength: number;
    responseTime: number;
  }> {
    const debugUrl = this.buildDebugUrl(baseUrl, options);
    const startTime = Date.now();

    const response = await fetch(debugUrl);

    if (!response.ok) {
      throw new NetSuiteValidationError(
        `Failed to fetch SEO debug page: ${response.status} ${response.statusText}`,
      );
    }

    const html = await response.text();
    const responseTime = Date.now() - startTime;

    return {
      url: debugUrl,
      html,
      contentLength: html.length,
      responseTime,
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
      const nameMatch = attrs?.match(/name=["']([^"']+)["']/i);
      const propertyMatch = attrs?.match(/property=["']([^"']+)["']/i);
      const contentMatch = attrs?.match(/content=["']([^"']+)["']/i);

      const key = nameMatch?.[1] || propertyMatch?.[1];
      const value = contentMatch?.[1];

      if (key && value) {
        metaTags[key] = value;
      }
    }

    return metaTags;
  }

  /**
   * Check if page is SEO-friendly
   */
  analyzeSEO(html: string): {
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
