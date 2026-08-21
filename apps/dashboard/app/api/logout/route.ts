import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@market-outreach/core";

/**
 * Sign-out. A POST rather than a link so a stray GET (prefetch, crawler,
 * image loader) can't sign someone out.
 */
export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/login", request.url), { status: 303 });
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
