import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/setup-required"];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    // Supabase not configured yet — redirect to a friendly setup page
    // instead of letting every Supabase-backed Server Component crash.
    if (request.nextUrl.pathname === "/setup-required") return response;
    const url = request.nextUrl.clone();
    url.pathname = "/setup-required";
    return NextResponse.redirect(url);
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // api/n8n and api/providers are server-to-server routes, secret-header
  // protected inside the route handler itself (x-n8n-webhook-secret) —
  // they must never require a browser session cookie, since n8n never has
  // one. Excluded from the matcher entirely rather than added to
  // PUBLIC_PATHS, since PUBLIC_PATHS is for pages a signed-out human can
  // browse to, not for secret-protected server calls.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/n8n|api/providers).*)"],
};
