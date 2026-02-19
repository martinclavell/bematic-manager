/**
 * Comprehensive Schema.org type definitions for e-commerce websites
 * Based on 2025 best practices and Schema.org specification
 */

/**
 * Schema types recommended by page type
 */
export const ECOMMERCE_SCHEMAS_BY_PAGE = {
  homepage: {
    critical: ['Organization', 'WebSite'],
    high: ['SearchAction', 'BreadcrumbList', 'SiteNavigationElement'],
    medium: ['ContactPoint', 'PostalAddress', 'OpeningHoursSpecification'],
  },
  category: {
    critical: ['BreadcrumbList', 'ItemList'],
    high: ['CollectionPage'],
    medium: ['OfferCatalog'],
  },
  product: {
    critical: ['Product', 'Offer', 'AggregateRating'],
    high: ['Review', 'Brand', 'ImageObject', 'BreadcrumbList'],
    medium: ['VideoObject', 'QuantitativeValue', 'FAQPage', 'Question', 'Answer'],
  },
} as const;

/**
 * Priority classification for all schema types
 */
export const SCHEMA_PRIORITIES: Record<string, 'P0' | 'P1' | 'P2'> = {
  // P0 - Critical (Essential for basic SEO and rich results)
  'Organization': 'P0',
  'WebSite': 'P0',
  'Product': 'P0',
  'Offer': 'P0',
  'BreadcrumbList': 'P0',
  'ItemList': 'P0',
  'AggregateRating': 'P0',

  // P1 - High (Important for enhanced search visibility)
  'SearchAction': 'P1',
  'Review': 'P1',
  'Brand': 'P1',
  'ImageObject': 'P1',
  'SiteNavigationElement': 'P1',
  'ContactPoint': 'P1',
  'PostalAddress': 'P1',
  'CollectionPage': 'P1',

  // P2 - Medium (Valuable for comprehensive coverage)
  'VideoObject': 'P2',
  'QuantitativeValue': 'P2',
  'FAQPage': 'P2',
  'Question': 'P2',
  'Answer': 'P2',
  'HowTo': 'P2',
  'OpeningHoursSpecification': 'P2',
  'OfferCatalog': 'P2',
};

/**
 * Required properties for each schema type
 */
export const SCHEMA_REQUIRED_PROPERTIES: Record<string, string[]> = {
  'Organization': ['name', 'url'],
  'WebSite': ['name', 'url'],
  'SearchAction': ['target', 'query-input'],
  'Product': ['name', 'image', 'offers'],
  'Offer': ['price', 'priceCurrency', 'availability'],
  'AggregateRating': ['ratingValue', 'reviewCount'],
  'Review': ['reviewRating', 'author'],
  'Brand': ['name'],
  'BreadcrumbList': ['itemListElement'],
  'ItemList': ['itemListElement'],
  'ImageObject': ['url'],
  'VideoObject': ['name', 'description', 'thumbnailUrl', 'uploadDate'],
  'ContactPoint': ['contactType'],
  'PostalAddress': ['streetAddress', 'addressLocality', 'addressCountry'],
  'FAQPage': ['mainEntity'],
  'Question': ['name', 'acceptedAnswer'],
  'Answer': ['text'],
  'CollectionPage': ['name'],
  'OfferCatalog': ['name', 'itemListElement'],
};

/**
 * Recommended (but not required) properties for enhanced rich results
 */
export const SCHEMA_RECOMMENDED_PROPERTIES: Record<string, string[]> = {
  'Organization': ['logo', 'contactPoint', 'address', 'sameAs'],
  'WebSite': ['potentialAction'],
  'Product': ['description', 'sku', 'brand', 'aggregateRating', 'review', 'gtin', 'mpn'],
  'Offer': ['seller', 'priceValidUntil', 'url', 'itemCondition'],
  'AggregateRating': ['bestRating', 'worstRating'],
  'Review': ['reviewBody', 'datePublished'],
  'Brand': ['logo', 'url'],
  'BreadcrumbList': [],
  'ItemList': ['numberOfItems'],
  'ImageObject': ['width', 'height', 'caption'],
  'VideoObject': ['duration', 'contentUrl', 'embedUrl'],
  'ContactPoint': ['telephone', 'email', 'availableLanguage'],
  'PostalAddress': ['addressRegion', 'postalCode'],
  'FAQPage': [],
  'Question': [],
  'Answer': [],
};

/**
 * Schema type descriptions for reporting
 */
export const SCHEMA_DESCRIPTIONS: Record<string, string> = {
  'Organization': 'Company information for knowledge panels and brand recognition',
  'WebSite': 'Homepage identification and sitelinks search box eligibility',
  'SearchAction': 'Enables sitelinks search box in SERPs',
  'Product': 'Core product information with pricing and availability',
  'Offer': 'Pricing, availability, and purchase conditions',
  'AggregateRating': 'Overall customer rating display in search results',
  'Review': 'Individual customer reviews and testimonials',
  'Brand': 'Manufacturer or brand information',
  'BreadcrumbList': 'Navigation hierarchy path for desktop SERPs',
  'ItemList': 'Product listing structure for category pages',
  'ImageObject': 'Product image metadata and attribution',
  'VideoObject': 'Product demonstration or promotional videos',
  'ContactPoint': 'Customer service contact information',
  'PostalAddress': 'Physical business location',
  'FAQPage': 'Frequently asked questions for FAQ rich results',
  'Question': 'Individual question in Q&A or FAQ',
  'Answer': 'Answer to a question',
  'SiteNavigationElement': 'Main navigation structure understanding',
  'CollectionPage': 'Category or collection page identification',
  'OfferCatalog': 'Product collection or catalog organization',
  'QuantitativeValue': 'Product measurements and specifications',
  'OpeningHoursSpecification': 'Business hours and availability',
  'HowTo': 'Step-by-step instructions or tutorials',
};

/**
 * Expected SEO impact by priority level
 */
export const IMPACT_BY_PRIORITY = {
  P0: 'Critical - Required for basic rich results eligibility',
  P1: 'High - Significantly improves search visibility and CTR',
  P2: 'Medium - Enhances user experience and AI optimization',
} as const;

/**
 * Get all schemas that should be present on a given page type
 */
export function getRecommendedSchemas(pageType: 'homepage' | 'category' | 'product'): string[] {
  const schemas = ECOMMERCE_SCHEMAS_BY_PAGE[pageType];
  return [...schemas.critical, ...schemas.high, ...schemas.medium];
}

/**
 * Get critical schemas that MUST be present on a given page type
 */
export function getCriticalSchemas(pageType: 'homepage' | 'category' | 'product'): string[] {
  return [...ECOMMERCE_SCHEMAS_BY_PAGE[pageType].critical];
}

/**
 * Check if a schema is missing required properties
 */
export function validateSchemaProperties(
  schemaType: string,
  schemaData: any
): {
  missingRequired: string[];
  missingRecommended: string[];
} {
  const required = SCHEMA_REQUIRED_PROPERTIES[schemaType] || [];
  const recommended = SCHEMA_RECOMMENDED_PROPERTIES[schemaType] || [];

  const missingRequired = required.filter(prop => {
    return !(prop in schemaData) || schemaData[prop] === null || schemaData[prop] === undefined;
  });

  const missingRecommended = recommended.filter(prop => {
    return !(prop in schemaData) || schemaData[prop] === null || schemaData[prop] === undefined;
  });

  return {
    missingRequired,
    missingRecommended,
  };
}

/**
 * Calculate schema completeness score (0-100)
 */
export function calculateSchemaScore(
  schemaType: string,
  schemaData: any
): {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
} {
  const required = SCHEMA_REQUIRED_PROPERTIES[schemaType] || [];
  const recommended = SCHEMA_RECOMMENDED_PROPERTIES[schemaType] || [];

  if (required.length === 0 && recommended.length === 0) {
    return { score: 100, grade: 'A' };
  }

  const requiredPresent = required.filter(prop =>
    prop in schemaData && schemaData[prop] !== null && schemaData[prop] !== undefined
  ).length;

  const recommendedPresent = recommended.filter(prop =>
    prop in schemaData && schemaData[prop] !== null && schemaData[prop] !== undefined
  ).length;

  // Required properties are worth 70%, recommended are worth 30%
  const requiredScore = required.length > 0 ? (requiredPresent / required.length) * 70 : 70;
  const recommendedScore = recommended.length > 0 ? (recommendedPresent / recommended.length) * 30 : 30;

  const score = Math.round(requiredScore + recommendedScore);

  let grade: 'A' | 'B' | 'C' | 'D' | 'F';
  if (score >= 90) grade = 'A';
  else if (score >= 80) grade = 'B';
  else if (score >= 70) grade = 'C';
  else if (score >= 60) grade = 'D';
  else grade = 'F';

  return { score, grade };
}
