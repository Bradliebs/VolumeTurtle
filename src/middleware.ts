import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = [
  "/api/scan/scheduled",
  "/api/auth/login",
  "/login",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname.startsWith(p));
}

/**
 * Constant-time string comparison safe for Edge Runtime.
 * Node's crypto.timingSafeEqual is not available in Next.js middleware (Edge).
 * Pads to equal length to avoid leaking token length via early return.
 */
function safeTokenEquals(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let mismatch = a.length !== b.length ? 1 : 0;
  for (let i = 0; i < len; i++) {
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

export function middleware(request: NextRequest) {
  const token = process.env.DASHBOARD_TOKEN;

  // Fail CLOSED: no token configured → deny access (redirect to login)
  if (!token) {
    const { pathname } = request.nextUrl;
    if (isPublicPath(pathname) || pathname.startsWith("/_next") || pathname.startsWith("/favicon") || pathname.endsWith(".ico")) {
      return NextResponse.next();
    }
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Auth not configured" }, { status: 500 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const { pathname } = request.nextUrl;

  // Scheduled scan has its own token auth
  if (isPublicPath(pathname)) return NextResponse.next();

  // Allow static assets and Next.js internals
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.endsWith(".ico")
  ) {
    return NextResponse.next();
  }

  // Check cookie (timing-safe comparison)
  const cookieToken = request.cookies.get("vt-auth")?.value;
  if (cookieToken && safeTokenEquals(cookieToken, token)) return NextResponse.next();

  // Check Authorization header (timing-safe comparison)
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    const bearerToken = authHeader.replace(/^Bearer\s+/i, "");
    if (safeTokenEquals(bearerToken, token)) return NextResponse.next();
  }

  // API routes return 401 JSON
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  // Pages redirect to login
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // Match all routes except static files
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
