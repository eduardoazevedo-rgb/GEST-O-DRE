import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isLogin = pathname.startsWith("/login");
  // Redefinição de senha: acessível sem sessão (chega pelo link do e-mail) e
  // mantida mesmo com a sessão temporária de recuperação (não redireciona p/ DRE).
  const isReset = pathname.startsWith("/redefinir-senha");
  const isPublicAsset =
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/icons") ||
    pathname === "/manifest.json" ||
    pathname === "/favicon.ico";

  if (isPublicAsset) return supabaseResponse;

  // Não autenticado tentando acessar área protegida → redireciona para login
  if (!user && !isLogin && !isReset) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Autenticado tentando acessar o login → redireciona para o DRE
  if (user && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/dre";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
