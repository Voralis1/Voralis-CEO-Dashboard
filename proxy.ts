import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC_ROUTES = ["/login"];

// Réservé au rôle CEO : contient/pilote COGS, coût call center, marge plancher T. Ceci est du
// confort d'UX (éviter d'atterrir sur un écran vide/en erreur) — la vraie protection est côté
// API (GET/PATCH /api/market-settings vérifient le rôle indépendamment, cf. lib/auth/role.ts).
const CEO_ONLY_ROUTES = ["/ceo/market-settings"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublicRoute = PUBLIC_ROUTES.includes(path);

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/ceo";
    return NextResponse.redirect(url);
  }

  if (user && CEO_ONLY_ROUTES.some((r) => path.startsWith(r)) && user.app_metadata?.role !== "ceo") {
    const url = request.nextUrl.clone();
    url.pathname = "/ceo";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
