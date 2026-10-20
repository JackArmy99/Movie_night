import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, authToken } from "./lib/token";

// Everything is behind the shared passcode except the sign-in page, the
// calendar feed (which carries its own key) and the files a phone needs to
// install the app.
export async function middleware(req: NextRequest) {
  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (cookie && cookie === (await authToken())) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|api/calendar|api/cron|_next|manifest.webmanifest|icon|apple-icon|favicon).*)"],
};
