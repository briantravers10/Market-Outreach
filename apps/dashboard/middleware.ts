import { NextResponse, type NextRequest } from "next/server";
// Subpath import, NOT the package barrel: the barrel reaches node:fs via
// config.ts, which the Edge runtime cannot load. session.ts is deliberately
// Web-Crypto-only so it works here.
import { SESSION_COOKIE, verifySessionToken } from "@market-outreach/core/auth/session";
import { getAuthConfig, isMisconfigured, isPublicPath } from "./lib/authConfig";

/**
 * Route protection.
 *
 * Runs on the Edge runtime, so it can only do things Edge supports: read
 * cookies and verify an HMAC via Web Crypto. It deliberately does NOT touch
 * the database — the session is self-contained and signed, which is what makes
 * this possible (see packages/core/src/auth/session.ts).
 *
 * Auth is checked here rather than per-page so a new page cannot accidentally
 * ship unprotected: the default is protected, and exceptions are the short
 * explicit list in PUBLIC_PATHS.
 */
export async function middleware(request: NextRequest) {
  const config = getAuthConfig();
  const { pathname, search } = request.nextUrl;

  // A real deployment with no auth configured serves nothing at all.
  if (isMisconfigured(config)) {
    return new NextResponse(
      "This deployment has no authentication configured. Set SESSION_SECRET (and ADMIN_EMAIL / ADMIN_PASSWORD_HASH) before serving real data. See README.md.",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } }
    );
  }

  // Public read-only demo of synthetic data — no login, nothing sensitive.
  if (!config.enabled) return NextResponse.next();

  const session = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value, config.sessionSecret);

  if (session && isPublicPath(pathname)) {
    return NextResponse.redirect(new URL("/overview", request.url));
  }
  if (session || isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Preserve where they were headed so login can return them there. Only the
  // path+query is carried, never an absolute URL, so this can't be turned into
  // an open redirect to another host.
  const loginUrl = new URL("/login", request.url);
  const target = `${pathname}${search}`;
  if (target && target !== "/" && !target.startsWith("//")) {
    loginUrl.searchParams.set("next", target);
  }
  const response = NextResponse.redirect(loginUrl);
  // Clear an expired/invalid cookie so the browser stops sending it.
  if (request.cookies.get(SESSION_COOKIE)) response.cookies.delete(SESSION_COOKIE);
  return response;
}

export const config = {
  // Everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
