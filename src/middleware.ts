import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PROTECTED_OPERATOR_ROUTES = ['/operations', '/incidents', '/fleet', '/history', '/admin'];
const PROTECTED_WORKER_ROUTES = ['/worker'];

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // If Supabase environment variables are missing or placeholders, allow preview without crashing
  if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes('placeholder')) {
    return supabaseResponse;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // Refresh auth session
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isOperatorRoute = PROTECTED_OPERATOR_ROUTES.some((route) =>
    pathname === route || pathname.startsWith(`${route}/`)
  );
  const isWorkerRoute = PROTECTED_WORKER_ROUTES.some((route) =>
    pathname === route || pathname.startsWith(`${route}/`)
  );
  const isAuthRoute = pathname === '/login';

  // 1. Unauthenticated users attempting to access protected surfaces
  if (!user && (isOperatorRoute || isWorkerRoute)) {
    const redirectUrl = new URL('/login', request.url);
    redirectUrl.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // 2. Authenticated users
  if (user) {
    // Fetch profile to verify role and active status
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, is_active')
      .eq('id', user.id)
      .single();

    // Inactive account handling
    if (profile && !profile.is_active) {
      await supabase.auth.signOut();
      const redirectUrl = new URL('/login', request.url);
      redirectUrl.searchParams.set('error', 'account_inactive');
      return NextResponse.redirect(redirectUrl);
    }

    const role = profile?.role;

    // Logged in user visiting login page -> redirect to their main surface
    if (isAuthRoute) {
      if (role === 'worker') {
        return NextResponse.redirect(new URL('/worker', request.url));
      }
      return NextResponse.redirect(new URL('/operations', request.url));
    }

    // Role-based boundary enforcement:
    // A. Workers cannot access operator desktop surfaces
    if (role === 'worker' && isOperatorRoute) {
      const redirectUrl = new URL('/worker', request.url);
      redirectUrl.searchParams.set('error', 'unauthorized_surface');
      return NextResponse.redirect(redirectUrl);
    }

    // B. Operators cannot access admin-only surface
    if (role === 'operator' && (pathname === '/admin' || pathname.startsWith('/admin/'))) {
      const redirectUrl = new URL('/operations', request.url);
      redirectUrl.searchParams.set('error', 'admin_required');
      return NextResponse.redirect(redirectUrl);
    }

    // C. Non-workers accessing worker surface can view it, or operators can be allowed
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files with extensions (.svg, .png, .jpg, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
