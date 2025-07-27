import { type NextRequest, NextResponse } from 'next/server';
import { isDev } from './lib/environment';
import { createLogger } from './lib/logs/console-logger';
import { getBaseDomain } from './lib/urls/utils';

const logger = createLogger('Middleware');

const SUSPICIOUS_UA_PATTERNS = [
  /^\s*$/, // Empty user agents
  /\.\./, // Path traversal attempt
  /<\s*script/i, // Potential XSS payloads
  /^\(\)\s*{/, // Command execution attempt
  /\b(sqlmap|nikto|gobuster|dirb|nmap)\b/i, // Known scanning tools
];

const BASE_DOMAIN = getBaseDomain();

export async function middleware(request: NextRequest) {
  const url = request.nextUrl;
  const hostname = request.headers.get('host') || '';

  const isCustomDomain = (() => {
    if (hostname === BASE_DOMAIN || hostname.startsWith('www.')) {
      return false;
    }
    const baseParts = BASE_DOMAIN.split('.');
    const rootDomain = isDev
      ? 'localhost'
      : baseParts.length >= 2
      ? baseParts.slice(-2).join('.')
      : BASE_DOMAIN;
    if (!hostname.includes(rootDomain)) {
      return false;
    }
    const hostParts = hostname.split('.');
    const basePartCount = BASE_DOMAIN.split('.').length;
    if (hostParts.length > basePartCount) {
      return true;
    }
    return hostname !== BASE_DOMAIN;
  })();

  const subdomain = isCustomDomain ? hostname.split('.')[0] : null;

  if (subdomain && isCustomDomain) {
    if (
      url.pathname.startsWith('/api/chat/') ||
      url.pathname.startsWith('/api/proxy/')
    ) {
      return NextResponse.next();
    }
    return NextResponse.rewrite(
      new URL(`/chat/${subdomain}${url.pathname}`, request.url),
    );
  }

  if (url.pathname === '/w' || url.pathname.startsWith('/w/')) {
    const pathParts = url.pathname.split('/');
    if (pathParts.length >= 3 && pathParts[1] === 'w') {
      const workflowId = pathParts[2];
      return NextResponse.redirect(
        new URL(`/workspace?redirect_workflow=${workflowId}`, request.url),
      );
    }
    return NextResponse.redirect(new URL('/workspace', request.url));
  }

  const userAgent = request.headers.get('user-agent') || '';
  const isWebhookEndpoint = url.pathname.startsWith('/api/webhooks/trigger/');
  const isSuspicious = SUSPICIOUS_UA_PATTERNS.some((pattern) =>
    pattern.test(userAgent),
  );
  if (isSuspicious && !isWebhookEndpoint) {
    logger.warn('Blocked suspicious request', {
      userAgent,
      ip: request.headers.get('x-forwarded-for') || 'unknown',
      url: request.url,
      method: request.method,
      pattern: SUSPICIOUS_UA_PATTERNS.find((pattern) =>
        pattern.test(userAgent),
      )?.toString(),
    });
    return new NextResponse(null, {
      status: 403,
      statusText: 'Forbidden',
      headers: {
        'Content-Type': 'text/plain',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "default-src 'none'",
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    });
  }

  const response = NextResponse.next();
  response.headers.set('Vary', 'User-Agent');
  return response;
}

export const config = {
  matcher: [
    '/w',
    '/w/:path*',
    '/workspace/:path*',
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};

