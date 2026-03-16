import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = [
  "/api/scan/scheduled",
  "/login",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname.startsWith(p));
}

export function middleware(request: NextRequest) {
  const token = process.env.DASHBOARD_TOKEN;

  // If no token configured, auth is disabled (backward compatible)
  if (!token) return NextResponse.next();

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

  // Check cookie
  const cookieToken = request.cookies.get("vt-auth")?.value;
  if (cookieToken === token) return NextResponse.next();

  // Check Authorization header (for API clients / scripts)
  const authHeader = request.headers.get("authorization");
  if (authHeader === `Bearer ${token}`) return NextResponse.next();

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
