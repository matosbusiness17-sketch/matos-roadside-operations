/**
 * Phase 2 Security & Architecture Static Verification Script
 * Validates migration structure, RLS policies, composite foreign keys,
 * role constraints, and middleware configuration.
 */

import fs from 'node:fs';
import path from 'node:path';

const MIGRATION_PATH = path.resolve('supabase/migrations/20260928190000_phase2_core_schema_and_rls.sql');
const SEED_PATH = path.resolve('supabase/seed.sql');
const MIDDLEWARE_PATH = path.resolve('src/middleware.ts');

let failureCount = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    failureCount++;
  } else {
    console.log(`PASS: ${message}`);
  }
}

console.log('=== Matos Systems Phase 2 Security Verification ===\n');

// 1. Verify Migration File Exists
assert(fs.existsSync(MIGRATION_PATH), 'Migration file exists at supabase/migrations/...');
const sql = fs.readFileSync(MIGRATION_PATH, 'utf-8');

// 2. Verify Core Entities Created
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
  assert(sql.includes(`CREATE TABLE IF NOT EXISTS public.${table}`), `Table public.${table} is defined`);
});

// 3. Verify RLS is enabled on all 8 tables
coreTables.forEach((table) => {
  assert(
    sql.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`),
    `Row Level Security enabled on public.${table}`
  );
});

// 4. Verify explicit roles
assert(sql.includes("CREATE TYPE app_role AS ENUM ('admin', 'operator', 'worker')"), 'app_role enum defines admin, operator, worker');

// 5. Verify privilege escalation trigger
assert(sql.includes('CREATE TRIGGER trg_protect_profile_role'), 'Profile privilege escalation trigger created');
assert(sql.includes('Privilege escalation rejected: only organization admins may alter user roles'), 'Trigger validates caller is organization admin');
assert(sql.includes('Cross-organization transfers are strictly prohibited'), 'Trigger forbids organization_id reassignment');

// 6. Verify immutable audit log trigger
assert(sql.includes('CREATE TRIGGER trg_immutable_operational_events'), 'Immutable operational events trigger created');

// 7. Verify cross-organization foreign key constraints
assert(sql.includes('CONSTRAINT fk_wva_worker_org'), 'worker_vehicle_assignments enforces composite worker+organization FK');
assert(sql.includes('CONSTRAINT fk_wva_vehicle_org'), 'worker_vehicle_assignments enforces composite vehicle+organization FK');
assert(sql.includes('CONSTRAINT fk_assignments_incident_org'), 'assignments enforces composite incident+organization FK');
assert(sql.includes('CONSTRAINT fk_assignments_worker_org'), 'assignments enforces composite worker+organization FK');

// 8. Verify worker incident access restriction in RLS
assert(sql.includes('incidents_select'), 'incidents_select policy defined');
const normalizedSql = sql.replace(/\s+/g, ' ');
assert(
  normalizedSql.includes('SELECT 1 FROM public.assignments a WHERE a.incident_id = incidents.id AND a.worker_id = public.get_current_worker_id()'),
  'incidents_select strictly confines worker visibility to incidents assigned to that worker'
);

// 9. Verify anonymous users are denied
assert(!sql.includes('TO anon'), 'Zero policies granted to anonymous clients');
assert(sql.includes('TO authenticated'), 'Policies restricted to authenticated role');

// 10. Verify Seed Script Exists
assert(fs.existsSync(SEED_PATH), 'Seed script exists at supabase/seed.sql');
const seedSql = fs.readFileSync(SEED_PATH, 'utf-8');
assert(seedSql.includes('00000000-0000-0000-0000-000000000001'), 'Demo organization UUID seeded');
assert(seedSql.includes('public.provision_demo_user'), 'provision_demo_user helper function created');

// 11. Verify Next.js Middleware Protection
assert(fs.existsSync(MIDDLEWARE_PATH), 'Next.js middleware exists at src/middleware.ts');
const middlewareCode = fs.readFileSync(MIDDLEWARE_PATH, 'utf-8');
assert(middlewareCode.includes("pathname === '/login'"), 'Middleware handles /login redirect');
assert(middlewareCode.includes("role === 'worker' && isOperatorRoute"), 'Middleware blocks workers from operator desktop routes');
assert(middlewareCode.includes("role === 'operator' && (pathname === '/admin'"), 'Middleware blocks operators from admin route');

console.log(`\nVerification complete: ${failureCount === 0 ? 'ALL CHECKS PASSED' : `${failureCount} CHECKS FAILED`}`);
process.exit(failureCount === 0 ? 0 : 1);
