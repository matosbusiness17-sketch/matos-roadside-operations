import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PROTECTED_OPERATOR_ROUTES = ['/operations', '/incidents', '/fleet', '/history', '/admin'];
const PROTECTED_WORKER_ROUTES = ['/worker'];

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const pathname = request.nextUrl.pathname;
  const isOperatorRoute = PROTECTED_OPERATOR_ROUTES.some((route) =>
    pathname === route || pathname.startsWith(`${route}/`)
  );
  const isWorkerRoute = PROTECTED_WORKER_ROUTES.some((route) =>
    pathname === route || pathname.startsWith(`${route}/`)
  );
  const isAdminRoute = pathname === '/admin' || pathname.startsWith('/admin/');
  const isProtectedRoute = isOperatorRoute || isWorkerRoute;
  const isAuthRoute = pathname === '/login';

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  const isConfigured = Boolean(
    supabaseUrl &&
    supabaseAnonKey &&
    !supabaseUrl.includes('placeholder')
  );

  // 1. Missing or invalid Supabase configuration:
  // Protected routes MUST NOT be allowed to proceed.
  if (!isConfigured || !supabaseUrl || !supabaseAnonKey) {
    if (isProtectedRoute) {
      const redirectUrl = new URL('/login', request.url);
      redirectUrl.searchParams.set('redirectTo', pathname);
      return NextResponse.redirect(redirectUrl);
    }
    // Public routes (/, /login, /customer/..., static assets) remain accessible
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

  // 2. Unauthenticated requests attempting to access protected surfaces:
  // Must fail closed and redirect to /login.
  if (!user) {
    if (isProtectedRoute) {
      const redirectUrl = new URL('/login', request.url);
      redirectUrl.searchParams.set('redirectTo', pathname);
      return NextResponse.redirect(redirectUrl);
    }
    return supabaseResponse;
  }

  // 3. Authenticated requests: Query profile for role and active status
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .single();

  // A. Profile lookup error or missing/null profile:
  // Protected routes MUST FAIL CLOSED. Missing profile data never grants access.
  if (profileError || !profile) {
    if (isProtectedRoute) {
      const redirectUrl = new URL('/login', request.url);
      redirectUrl.searchParams.set('error', 'profile_missing');
      return NextResponse.redirect(redirectUrl);
    }
    return supabaseResponse;
  }

  // B. Inactive account:
  // Deactivated users are signed out and redirected to /login.
  if (!profile.is_active) {
    await supabase.auth.signOut();
    const redirectUrl = new URL('/login', request.url);
    redirectUrl.searchParams.set('error', 'account_inactive');
    return NextResponse.redirect(redirectUrl);
  }

  // C. Undefined, null, or unrecognized role:
  // Only 'admin', 'operator', and 'worker' are valid application roles.
  const role = profile.role;
  const isRecognizedRole = role === 'admin' || role === 'operator' || role === 'worker';

  if (!isRecognizedRole) {
    if (isProtectedRoute) {
      const redirectUrl = new URL('/login', request.url);
      redirectUrl.searchParams.set('error', 'unauthorized_role');
      return NextResponse.redirect(redirectUrl);
    }
    return supabaseResponse;
  }

  // D. Logged-in user visiting /login:
  // Redirect to their default operational surface.
  if (isAuthRoute) {
    if (role === 'worker') {
      return NextResponse.redirect(new URL('/worker', request.url));
    }
    return NextResponse.redirect(new URL('/operations', request.url));
  }

  // E. Role-based protected surface boundaries:
  // - Worker attempting to access desktop operator routes: Block and redirect to /worker
  if (role === 'worker' && isOperatorRoute) {
    const redirectUrl = new URL('/worker', request.url);
    redirectUrl.searchParams.set('error', 'unauthorized_surface');
    return NextResponse.redirect(redirectUrl);
  }

  // - Operator attempting to access admin route: Block and redirect to /operations
  if (role === 'operator' && isAdminRoute) {
    const redirectUrl = new URL('/operations', request.url);
    redirectUrl.searchParams.set('error', 'admin_required');
    return NextResponse.redirect(redirectUrl);
  }

  // - Admin or Operator attempting to access /worker: Must not render as authorized worker
  if (isWorkerRoute && role !== 'worker') {
    const redirectUrl = new URL('/operations', request.url);
    redirectUrl.searchParams.set('error', 'worker_required');
    return NextResponse.redirect(redirectUrl);
  }

  // F. Authorized requests proceed to the requested surface
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
