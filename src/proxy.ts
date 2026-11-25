import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const PUBLIC_PATHS = ["/login", "/setup"];

/*
  First line of defence only: visitors without a session cookie are sent to
  the login page before anything renders. The cookie is not verified here.
  Real checks happen in requireUser(), next to the data.
*/
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();

  if (!getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api/auth|api/health|api/keep-awake|_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:png|svg|ico|webp|woff2)$).*)",
  ],
};
