import { IncomingMessage, ServerResponse } from 'node:http';
import { createLogger } from '@bematic/common';
import type { Config } from '../config.js';

const logger = createLogger('security-headers');

export interface SecurityHeadersOptions {
  isDevelopment: boolean;
  allowedOrigins: string[];
  enableHsts: boolean;
  enableCsp: boolean;
  customHeaders?: Record<string, string>;
}

/**
 * Security headers middleware for HTTP requests
 */
export function createSecurityHeadersMiddleware(config: Config) {
  const options: SecurityHeadersOptions = {
    isDevelopment: config.server.nodeEnv === 'development',
    allowedOrigins: [
      // Slack webhook origins
      'https://hooks.slack.com',
      'https://slack.com',
      // Railway health check origins
      'https://railway.app',
      'https://up.railway.app',
      // Development localhost
      ...(config.server.nodeEnv === 'development' ? ['http://localhost:3000', 'http://127.0.0.1:3000'] : []),
    ],
    enableHsts: config.server.nodeEnv === 'production' && config.ssl.enabled,
    enableCsp: true,
  };

  return function securityHeadersMiddleware(req: IncomingMessage, res: ServerResponse, next?: () => void) {
    // Set security headers
    setSecurityHeaders(res, options);

    // Handle CORS
    handleCors(req, res, options);

    // If this is a preflight request, end here
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    // Continue to next handler if provided
    if (next) {
      next();
    }
  };
}

function setSecurityHeaders(res: ServerResponse, options: SecurityHeadersOptions) {
  // HTTP Strict Transport Security (HSTS)
  if (options.enableHsts) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');

  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // XSS Protection (legacy but still useful for older browsers)
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Referrer Policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions Policy (Feature Policy successor)
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(), usb=()');

  // Content Security Policy
  if (options.enableCsp) {
    const cspDirectives = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'", // Slack integrations may need inline scripts
      "style-src 'self' 'unsafe-inline'", // Allow inline styles for health check responses
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self' wss: ws:",
      "worker-src 'none'",
      "object-src 'none'",
      "media-src 'none'",
      "frame-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
    ];

    // More relaxed CSP for development
    if (options.isDevelopment) {
      cspDirectives.push("upgrade-insecure-requests");
    }

    res.setHeader('Content-Security-Policy', cspDirectives.join('; '));
  }

  // Server header removal (don't reveal server info)
  res.removeHeader('Server');
  res.removeHeader('X-Powered-By');

  // Add custom headers if provided
  if (options.customHeaders) {
    Object.entries(options.customHeaders).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
  }

  logger.debug({
    hsts: options.enableHsts,
    csp: options.enableCsp,
    development: options.isDevelopment
  }, 'Security headers applied');
}

function handleCors(req: IncomingMessage, res: ServerResponse, options: SecurityHeadersOptions) {
  const origin = req.headers.origin;

  // Handle CORS
  if (origin) {
    // Check if origin is allowed
    const isAllowedOrigin = options.allowedOrigins.some(allowed => {
      if (allowed.includes('*')) {
        // Simple wildcard matching
        const pattern = allowed.replace(/\*/g, '.*');
        return new RegExp(`^${pattern}$`).test(origin);
      }
      return allowed === origin;
    });

    if (isAllowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      logger.debug({ origin }, 'CORS origin allowed');
    } else {
      logger.warn({ origin, allowedOrigins: options.allowedOrigins }, 'CORS origin blocked');
    }
  } else if (options.isDevelopment) {
    // In development, allow no-origin requests (e.g., direct browser access)
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  // Set CORS headers for preflight requests
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, X-Requested-With');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
}

/**
 * Wrapper function for applying security headers to any HTTP response
 */
export function applySecurityHeaders(res: ServerResponse, config: Config) {
  const options: SecurityHeadersOptions = {
    isDevelopment: config.server.nodeEnv === 'development',
    allowedOrigins: [
      'https://hooks.slack.com',
      'https://slack.com',
      'https://railway.app',
      'https://up.railway.app',
    ],
    enableHsts: config.server.nodeEnv === 'production' && config.ssl.enabled,
    enableCsp: true,
  };

  setSecurityHeaders(res, options);
}

/**
 * Security audit function to validate current security posture
 */
export function auditSecurityHeaders(headers: Record<string, string | string[]>): {
  score: number;
  issues: string[];
  recommendations: string[];
} {
  const issues: string[] = [];
  const recommendations: string[] = [];
  let score = 100;

  // Check for required security headers
  const requiredHeaders = [
    'X-Frame-Options',
    'X-Content-Type-Options',
    'X-XSS-Protection',
    'Referrer-Policy',
    'Content-Security-Policy',
  ];

  requiredHeaders.forEach(header => {
    if (!headers[header.toLowerCase()]) {
      issues.push(`Missing ${header} header`);
      score -= 15;
    }
  });

  // Check HSTS for HTTPS
  if (!headers['strict-transport-security']) {
    recommendations.push('Consider enabling HSTS for HTTPS connections');
    score -= 10;
  }

  // Check CSP quality
  const csp = headers['content-security-policy'] as string;
  if (csp) {
    if (csp.includes("'unsafe-eval'")) {
      issues.push("CSP allows 'unsafe-eval' which is dangerous");
      score -= 20;
    }
    if (csp.includes("'unsafe-inline'") && csp.includes('script-src')) {
      recommendations.push("Consider removing 'unsafe-inline' from script-src for better security");
      score -= 5;
    }
  }

  return { score, issues, recommendations };
}