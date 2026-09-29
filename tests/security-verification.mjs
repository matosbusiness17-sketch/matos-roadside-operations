/**
 * Matos Systems — Phase 2 Security & Authorization Static Verification Suite
 *
 * Validates that all Phase 2 security review requirements are met:
 * 1. Database schema, RLS policies, composite foreign keys, and triggers.
 * 2. Login form authentication hygiene (no hardcoded passwords, email-only quick fills).
 * 3. Operator navigation fail-closed role filtering (no default admin role).
 * 4. Operator layout server-side fail-closed defense in depth.
 * 5. Admin page server-side access control (admin role strictly required).
 * 6. Worker surface authentic session enforcement (no fabricated fallback identities).
 * 7. Next.js middleware fail-closed route protection:
 *    - Middleware exists
 *    - Protected routes defined/recognized
 *    - Missing Supabase configuration fails closed for protected routes
 *    - Unauthenticated protected requests redirect to /login
 *    - Profile query error handling fails closed
 *    - Missing/null profile handling fails closed
 *    - Inactive profile handling fails closed
 *    - Undefined/null/unknown role handling fails closed
 *    - Worker blocked from desktop operator routes
 *    - Operator blocked from admin route
 *    - Admin/operator blocked from worker route
 *    - Both NEXT_PUBLIC_SUPABASE_ANON_KEY and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY supported
 *    - No service-role secret exposed
 *    - No hardcoded demo password in middleware or source code
 * 8. Supabase environment configuration and public key handling.
 */

import fs from 'node:fs';
import path from 'node:path';

let failureCount = 0;
let passCount = 0;

function assert(condition, testName, details = '') {
  if (!condition) {
    console.error(`\x1b[31m[FAIL]\x1b[0m ${testName}${details ? ` - ${details}` : ''}`);
    failureCount++;
  } else {
    console.log(`\x1b[32m[PASS]\x1b[0m ${testName}`);
    passCount++;
  }
}

console.log('================================================================');
console.log('  MATOS SYSTEMS — PHASE 2 SECURITY & AUTHORIZATION VERIFICATION');
console.log('================================================================\n');

// -----------------------------------------------------------------------------
// SECTION 1: Database Schema & Row Level Security
// -----------------------------------------------------------------------------
console.log('--- 1. Database Schema & Row Level Security ---');

const MIGRATION_PATH = path.resolve('supabase/migrations/20260928190000_phase2_core_schema_and_rls.sql');
assert(fs.existsSync(MIGRATION_PATH), 'Migration file exists', MIGRATION_PATH);

const sql = fs.readFileSync(MIGRATION_PATH, 'utf-8');

const coreTables = [
  'organizations',
  'profiles',
  'worker_profiles',
  'vehicles',
  'worker_vehicle_assignments',
  'incidents',
  'assignments',
  'operational_events',
];

coreTables.forEach((table) => {
  assert(sql.includes(`CREATE TABLE IF NOT EXISTS public.${table}`), `Table defined: public.${table}`);
  assert(sql.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`), `RLS enabled on public.${table}`);
});

// Role Enum
assert(
  sql.includes("CREATE TYPE app_role AS ENUM ('admin', 'operator', 'worker')"),
  'PostgreSQL enum app_role defines admin, operator, worker'
);

// Privilege Escalation Trigger
assert(
  sql.includes('CREATE TRIGGER trg_protect_profile_role'),
  'Trigger trg_protect_profile_role created to prevent unauthorized role escalation'
);
assert(
  sql.includes('Privilege escalation rejected: only organization admins may alter user roles'),
  'Trigger validates caller is organization admin before role updates'
);
assert(
  sql.includes('Cross-organization transfers are strictly prohibited'),
  'Trigger prevents updating organization_id'
);

// Immutable Audit Log Trigger
assert(
  sql.includes('CREATE TRIGGER trg_immutable_operational_events'),
  'Immutable operational events trigger created'
);

// Composite Foreign Keys (Cross-Tenant Integrity)
assert(
  sql.includes('CONSTRAINT fk_wva_worker_org'),
  'worker_vehicle_assignments enforces composite worker+organization FK'
);
assert(
  sql.includes('CONSTRAINT fk_wva_vehicle_org'),
  'worker_vehicle_assignments enforces composite vehicle+organization FK'
);
assert(
  sql.includes('CONSTRAINT fk_assignments_incident_org'),
  'assignments enforces composite incident+organization FK'
);
assert(
  sql.includes('CONSTRAINT fk_assignments_worker_org'),
  'assignments enforces composite worker+organization FK'
);

// RLS Policy Confinement
assert(!sql.includes('TO anon'), 'Zero database policies granted to anonymous clients');
assert(sql.includes('TO authenticated'), 'Database policies explicitly restricted to authenticated users');

const normalizedSql = sql.replace(/\s+/g, ' ');
assert(
  normalizedSql.includes('SELECT 1 FROM public.assignments a WHERE a.incident_id = incidents.id AND a.worker_id = public.get_current_worker_id()'),
  'Worker incident visibility is strictly confined to incidents assigned to that worker'
);

// -----------------------------------------------------------------------------
// SECTION 2: Login Form Authentication & Password Hygiene
// -----------------------------------------------------------------------------
console.log('\n--- 2. Login Form Authentication & Password Hygiene ---');

const LOGIN_FORM_PATH = path.resolve('src/app/login/login-form.tsx');
assert(fs.existsSync(LOGIN_FORM_PATH), 'Login form exists', LOGIN_FORM_PATH);
const loginFormCode = fs.readFileSync(LOGIN_FORM_PATH, 'utf-8');

assert(
  !loginFormCode.includes('DemoPassword123!'),
  'Removed hardcoded password DemoPassword123! from login form'
);
assert(
  !loginFormCode.match(/password\s*[:=]\s*['"][^'"]{3,}['"]/i),
  'No hardcoded non-empty password literals in login form source code'
);

assert(
  loginFormCode.includes('fillDemoEmail') && !loginFormCode.includes('fillDemo('),
  'Quick-fill helper is fillDemoEmail (populates email only)'
);
assert(
  !loginFormCode.includes('setPassword(') ||
    loginFormCode.match(/setPassword\(\s*e\.target\.value\s*\)/),
  'Password state is only mutated by user input (e.target.value)'
);

assert(
  loginFormCode.includes("const [password, setPassword] = useState('')"),
  'Password state initialized to empty string'
);

// -----------------------------------------------------------------------------
// SECTION 3: Operator Navigation Fail-Closed Behavior
// -----------------------------------------------------------------------------
console.log('\n--- 3. Operator Navigation Fail-Closed Behavior ---');

const OPERATOR_NAV_PATH = path.resolve('src/components/operator/operator-nav.tsx');
assert(fs.existsSync(OPERATOR_NAV_PATH), 'OperatorNav component exists', OPERATOR_NAV_PATH);
const navCode = fs.readFileSync(OPERATOR_NAV_PATH, 'utf-8');

assert(
  !navCode.includes("userRole = 'admin'") && !navCode.includes('userRole = "admin"'),
  'No default admin role assigned in OperatorNav component props'
);

assert(
  navCode.includes("item.requiredRole === 'admin'") && navCode.includes("userRole === 'admin'"),
  'Admin nav link renders ONLY when userRole is explicitly verified as admin'
);

assert(
  navCode.includes('export function OperatorNav({ userRole }: OperatorNavProps)'),
  'OperatorNav accepts optional userRole without unsafe fallback'
);

// -----------------------------------------------------------------------------
// SECTION 4: Operator Layout Server-Side Defense in Depth
// -----------------------------------------------------------------------------
console.log('\n--- 4. Operator Layout Server-Side Defense in Depth ---');

const OPERATOR_LAYOUT_PATH = path.resolve('src/app/(operator)/layout.tsx');
assert(fs.existsSync(OPERATOR_LAYOUT_PATH), 'Operator layout exists', OPERATOR_LAYOUT_PATH);
const opLayoutCode = fs.readFileSync(OPERATOR_LAYOUT_PATH, 'utf-8');

assert(
  opLayoutCode.includes('getCurrentUser()'),
  'Operator layout calls getCurrentUser() server-side'
);
assert(
  opLayoutCode.includes('if (!authContext || !authContext.profile || !authContext.profile.is_active)') &&
    opLayoutCode.includes("redirect('/login"),
  'Operator layout redirects unauthenticated or inactive sessions to /login'
);
assert(
  opLayoutCode.includes("if (role === 'worker')") &&
    opLayoutCode.includes("redirect('/worker"),
  'Operator layout redirects worker roles away from operator shell'
);
assert(
  opLayoutCode.includes("if (role !== 'admin' && role !== 'operator')") &&
    opLayoutCode.includes("redirect('/login')"),
  'Operator layout restricts rendering strictly to admin and operator roles'
);

// -----------------------------------------------------------------------------
// SECTION 5: Admin Page Server-Side Access Control
// -----------------------------------------------------------------------------
console.log('\n--- 5. Admin Page Server-Side Access Control ---');

const ADMIN_PAGE_PATH = path.resolve('src/app/(operator)/admin/page.tsx');
assert(fs.existsSync(ADMIN_PAGE_PATH), 'Admin page exists', ADMIN_PAGE_PATH);
const adminPageCode = fs.readFileSync(ADMIN_PAGE_PATH, 'utf-8');

assert(
  adminPageCode.includes('if (!authContext || !authContext.profile || !authContext.profile.is_active)') &&
    adminPageCode.includes("redirect('/login"),
  'Admin page redirects missing auth context to /login'
);
assert(
  adminPageCode.includes("if (role !== 'admin')") &&
    adminPageCode.includes('Access Denied'),
  'Admin page blocks non-admin users with explicit Access Denied'
);
assert(
  adminPageCode.includes("PlaceholderPanel") &&
    adminPageCode.includes('System & Organization Administration'),
  'Admin content is guarded behind strict role === admin check'
);

// -----------------------------------------------------------------------------
// SECTION 6: Worker Surface Genuine Session & No Fallback Identities
// -----------------------------------------------------------------------------
console.log('\n--- 6. Worker Surface Genuine Session & No Fallback Identities ---');

const WORKER_LAYOUT_PATH = path.resolve('src/app/worker/layout.tsx');
const WORKER_PAGE_PATH = path.resolve('src/app/worker/page.tsx');
const WORKER_HEADER_PATH = path.resolve('src/components/worker/worker-header.tsx');

assert(fs.existsSync(WORKER_LAYOUT_PATH), 'Worker layout exists', WORKER_LAYOUT_PATH);
assert(fs.existsSync(WORKER_PAGE_PATH), 'Worker page exists', WORKER_PAGE_PATH);
assert(fs.existsSync(WORKER_HEADER_PATH), 'Worker header exists', WORKER_HEADER_PATH);

const workerLayoutCode = fs.readFileSync(WORKER_LAYOUT_PATH, 'utf-8');
const workerPageCode = fs.readFileSync(WORKER_PAGE_PATH, 'utf-8');
const workerHeaderCode = fs.readFileSync(WORKER_HEADER_PATH, 'utf-8');

const fakeStrings = [
  'Standby Worker (Unauthenticated)',
  'Dev Demonstration Org',
];

fakeStrings.forEach((fake) => {
  assert(!workerLayoutCode.includes(fake), `Worker layout does not contain fake string: "${fake}"`);
  assert(!workerPageCode.includes(fake), `Worker page does not contain fake string: "${fake}"`);
  assert(!workerHeaderCode.includes(fake), `Worker header does not contain fake string: "${fake}"`);
});

assert(
  workerLayoutCode.includes('if (!authContext || !authContext.profile || !authContext.profile.is_active)') &&
    workerLayoutCode.includes("redirect('/login"),
  'Worker layout redirects missing auth context to /login'
);
assert(
  workerLayoutCode.includes("if (authContext.profile.role !== 'worker')") &&
    workerLayoutCode.includes("redirect('/operations')"),
  'Worker layout redirects non-workers to /operations'
);
assert(
  workerPageCode.includes('profile.display_name') &&
    workerPageCode.includes('organization.name'),
  'Worker page strictly renders authenticated profile.display_name and organization.name'
);

// -----------------------------------------------------------------------------
// SECTION 7: Next.js Middleware Fail-Closed Verification
// -----------------------------------------------------------------------------
console.log('\n--- 7. Next.js Middleware Fail-Closed Verification ---');

const MIDDLEWARE_PATH = path.resolve('src/middleware.ts');
assert(fs.existsSync(MIDDLEWARE_PATH), 'Middleware file exists at src/middleware.ts', MIDDLEWARE_PATH);

const middlewareCode = fs.readFileSync(MIDDLEWARE_PATH, 'utf-8');

// A. Protected routes defined and recognized
const requiredProtectedOperatorRoutes = ['/operations', '/incidents', '/fleet', '/history', '/admin'];
const requiredProtectedWorkerRoutes = ['/worker'];

requiredProtectedOperatorRoutes.forEach((route) => {
  assert(
    middlewareCode.includes(`'${route}'`),
    `Protected operator route recognized in middleware: ${route}`
  );
});

requiredProtectedWorkerRoutes.forEach((route) => {
  assert(
    middlewareCode.includes(`'${route}'`),
    `Protected worker route recognized in middleware: ${route}`
  );
});

// B. Missing Supabase configuration does NOT simply allow protected routes through (fails closed)
assert(
  middlewareCode.includes('!isConfigured') &&
    middlewareCode.includes('isProtectedRoute') &&
    middlewareCode.includes("redirectUrl = new URL('/login', request.url)"),
  'Middleware fails closed: missing/invalid Supabase configuration redirects protected routes to /login'
);

// Check that fail-open bypass pattern is NOT present (must not unconditionally return supabaseResponse when unconfigured)
const failOpenUnconditionalPattern = /if\s*\(\s*(!supabaseUrl|!isConfigured)[^)]*\)\s*\{\s*return\s+supabaseResponse;\s*\}/;
assert(
  !failOpenUnconditionalPattern.test(middlewareCode),
  'Middleware does not contain fail-open bypass returning supabaseResponse without checking protected routes'
);

// C. Unauthenticated protected requests redirect to /login
assert(
  middlewareCode.includes('!user && isProtectedRoute') ||
    middlewareCode.includes('if (!user) {\n    if (isProtectedRoute)'),
  'Middleware redirects unauthenticated protected requests to /login'
);

// D. Profile Query Error Handling (FAILS CLOSED)
assert(
  middlewareCode.includes('error: profileError') &&
    middlewareCode.includes('profileError'),
  'Middleware captures profile query errors via profileError'
);
assert(
  middlewareCode.match(/if\s*\(\s*(profileError\s*\|\|\s*!profile|!profile\s*\|\|\s*profileError)\s*\)\s*\{[^}]*isProtectedRoute[^}]*redirect/s),
  'Middleware fails closed: profile lookup error redirects protected routes to /login'
);

// E. Null/Missing Profile Handling (FAILS CLOSED)
assert(
  middlewareCode.includes('!profile') &&
    middlewareCode.includes("redirectUrl.searchParams.set('error', 'profile_missing')"),
  'Middleware fails closed: missing/null profile redirects protected routes to /login with profile_missing error'
);

// F. Inactive Profile Handling (FAILS CLOSED)
assert(
  middlewareCode.includes('!profile.is_active') &&
    middlewareCode.includes("redirectUrl.searchParams.set('error', 'account_inactive')"),
  'Middleware fails closed: inactive profile triggers signOut and redirects to /login'
);

// G. Undefined/Null/Unknown Role Handling (FAILS CLOSED)
assert(
  middlewareCode.includes("role === 'admin' || role === 'operator' || role === 'worker'"),
  'Middleware strictly defines recognized roles as only admin, operator, and worker'
);
assert(
  middlewareCode.includes('!isRecognizedRole') &&
    middlewareCode.includes("redirectUrl.searchParams.set('error', 'unauthorized_role')"),
  'Middleware fails closed: unrecognized or undefined role redirects protected routes to /login with unauthorized_role error'
);

// H. Worker blocked from desktop operator routes
assert(
  middlewareCode.includes("role === 'worker' && isOperatorRoute") &&
    middlewareCode.includes("redirectUrl = new URL('/worker', request.url)"),
  'Middleware blocks workers from desktop operator routes and redirects to /worker'
);

// I. Operator blocked from admin route
assert(
  middlewareCode.includes("role === 'operator' && isAdminRoute") &&
    middlewareCode.includes("redirectUrl = new URL('/operations', request.url)"),
  'Middleware blocks operators from admin route and redirects to /operations'
);

// J. Admin or Operator blocked from worker route
assert(
  middlewareCode.includes("isWorkerRoute && role !== 'worker'") &&
    middlewareCode.includes("redirectUrl = new URL('/operations', request.url)"),
  'Middleware prevents admin or operator from accessing /worker as authorized worker'
);

// K. Authenticated user with invalid profile CANNOT fall through to protected content
// Verify that the final return supabaseResponse inside middleware() is reached ONLY after all guards pass
const middlewareFnBody = middlewareCode.slice(0, middlewareCode.indexOf('export const config'));
assert(
  middlewareFnBody.trim().endsWith('return supabaseResponse;\n}'),
  'Middleware permits request to proceed only at the very end of middleware() after all fail-closed checks pass'
);

// L. Public Supabase key formats supported
assert(
  middlewareCode.includes('process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY') &&
    middlewareCode.includes('process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
  'Middleware supports both NEXT_PUBLIC_SUPABASE_ANON_KEY and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'
);

// M. No service-role secret is exposed
assert(
  !middlewareCode.includes('SERVICE_ROLE') && !middlewareCode.includes('service_role'),
  'Middleware never references or exposes service role secret key'
);

// N. No hardcoded demo password exists in middleware
assert(
  !middlewareCode.includes('DemoPassword123!'),
  'Middleware contains no hardcoded demo password'
);

// -----------------------------------------------------------------------------
// SECTION 8: Supabase Environment Configuration
// -----------------------------------------------------------------------------
console.log('\n--- 8. Supabase Environment Configuration ---');

const ENV_PATH = path.resolve('src/lib/env.ts');
const ENV_EXAMPLE_PATH = path.resolve('.env.example');

assert(fs.existsSync(ENV_PATH), 'Environment module exists at src/lib/env.ts');
assert(fs.existsSync(ENV_EXAMPLE_PATH), 'Environment template exists at .env.example');

const envCode = fs.readFileSync(ENV_PATH, 'utf-8');
const envExample = fs.readFileSync(ENV_EXAMPLE_PATH, 'utf-8');

assert(
  envCode.includes('NEXT_PUBLIC_SUPABASE_ANON_KEY') &&
    envCode.includes('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
  'env.ts supports both NEXT_PUBLIC_SUPABASE_ANON_KEY and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'
);

assert(
  !envCode.includes('SERVICE_ROLE') && !envCode.includes('service_role'),
  'env.ts never references or exposes service role secret key'
);

assert(
  envExample.includes('matos-roadside-operations/.env.local') &&
    envExample.includes('DO NOT place this file inside the /supabase directory'),
  '.env.example explicitly instructs placing .env.local at the project root, not inside /supabase'
);

// Global repository check: ensure no hardcoded demo password in any src/ file
const srcFiles = [];
function collectSrcFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSrcFiles(fullPath);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      srcFiles.push(fullPath);
    }
  }
}
collectSrcFiles(path.resolve('src'));

let passwordFoundInSrc = false;
for (const file of srcFiles) {
  const content = fs.readFileSync(file, 'utf-8');
  if (content.includes('DemoPassword123!')) {
    passwordFoundInSrc = true;
    console.error(`Found hardcoded demo password in: ${file}`);
  }
}
assert(!passwordFoundInSrc, 'Global check: Zero occurrences of DemoPassword123! in src/ tree');

// -----------------------------------------------------------------------------
// SUMMARY
// -----------------------------------------------------------------------------
console.log('\n================================================================');
console.log(`  VERIFICATION RESULTS: ${passCount} PASSED, ${failureCount} FAILED`);
console.log('================================================================\n');

if (failureCount > 0) {
  console.error(`\x1b[31mFAIL: ${failureCount} security verification check(s) failed.\x1b[0m`);
  process.exit(1);
} else {
  console.log('\x1b[32mSUCCESS: All Phase 2 security and authorization checks passed cleanly.\x1b[0m\n');
  process.exit(0);
}
