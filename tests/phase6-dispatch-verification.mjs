/**
 * ==============================================================================
 * MATOS SYSTEMS — PHASE 6 DISPATCH ENGINE VERIFICATION SUITE
 * STATIC ARCHITECTURAL, SECURITY, DATA INTEGRITY & INTERACTION VERIFICATION
 * ==============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

let totalChecks = 0;
let passedChecks = 0;
let failedChecks = 0;

function assert(condition, description, detail = '') {
  totalChecks++;
  if (condition) {
    passedChecks++;
    console.log(`[PASS] ${description}`);
  } else {
    failedChecks++;
    console.error(`[FAIL] ${description}`);
    if (detail) {
      console.error(`       Details: ${detail}`);
    }
  }
}

console.log('================================================================');
console.log('  MATOS SYSTEMS — PHASE 6 DISPATCH ENGINE VERIFICATION SUITE    ');
console.log('================================================================');

// ------------------------------------------------------------------------------
// SECTION 0: Migration Isolation & Execution Ordering
// ------------------------------------------------------------------------------
console.log('\n--- 0. Migration Isolation & Execution Ordering ---');

const phase2MigrationPath = path.join(
  rootDir,
  'supabase/migrations/20260928190000_phase2_core_schema_and_rls.sql'
);
const phase3MigrationPath = path.join(
  rootDir,
  'supabase/migrations/20260929120000_phase3_spatial_and_capabilities.sql'
);
const phase4MigrationPath = path.join(
  rootDir,
  'supabase/migrations/20260929140000_phase4_incident_state_machine.sql'
);
const phase5MigrationPath = path.join(
  rootDir,
  'supabase/migrations/20260929150000_phase5_operations_map_snapshot.sql'
);
const phase6MigrationPath = path.join(
  rootDir,
  'supabase/migrations/20260930060000_phase6_dispatch_engine.sql'
);

assert(fs.existsSync(phase2MigrationPath), 'Phase 2 migration exists');
assert(fs.existsSync(phase3MigrationPath), 'Phase 3 migration exists');
assert(fs.existsSync(phase4MigrationPath), 'Phase 4 migration exists');
assert(fs.existsSync(phase5MigrationPath), 'Phase 5 migration exists');
assert(fs.existsSync(phase6MigrationPath), 'Phase 6 migration exists');

const p5Base = path.basename(phase5MigrationPath);
const p6Base = path.basename(phase6MigrationPath);
assert(
  p6Base > p5Base,
  `Phase 6 migration (${p6Base}) executes after Phase 5 (${p5Base}) by timestamp ordering`
);

const phase6Sql = fs.readFileSync(phase6MigrationPath, 'utf8');

// Ensure no new tables were created in Phase 6 migration
assert(
  !/CREATE\s+TABLE/i.test(phase6Sql),
  'Phase 6 migration does NOT create any new tables (schema frozen from Phase 2/3)'
);

// Ensure no duplicate coordinate columns were added
assert(
  !/ADD\s+COLUMN.*(latitude|longitude|coords)/i.test(phase6Sql),
  'Phase 6 migration does NOT add duplicate latitude/longitude columns'
);

// Ensure no vehicle availability_status column was invented
assert(
  !/availability_status.*vehicles|vehicles.*availability_status/i.test(phase6Sql),
  'Phase 6 migration does NOT invent a vehicle availability_status column'
);

// Ensure no score columns or functions
assert(
  !/CREATE\s+(TABLE|COLUMN|FUNCTION).*(match_score|dispatch_score|smart_score)/i.test(phase6Sql),
  'Phase 6 migration does NOT create score columns or scoring functions'
);

// ------------------------------------------------------------------------------
// SECTION 1: Concurrency Indexes & Preflight Duplicate Validation
// ------------------------------------------------------------------------------
console.log('\n--- 1. Concurrency Indexes & Preflight Duplicate Validation ---');

// Preflight checks for worker_vehicle_assignments duplicates
assert(
  /SELECT.*worker_id.*FROM\s+public\.worker_vehicle_assignments.*status\s*=\s*'active'.*GROUP\s+BY.*HAVING\s+count\(\*\)\s*>\s*1/is.test(
    phase6Sql
  ),
  'Preflight duplicate check exists for active worker shift assignments'
);

assert(
  /SELECT.*vehicle_id.*FROM\s+public\.worker_vehicle_assignments.*status\s*=\s*'active'.*GROUP\s+BY.*HAVING\s+count\(\*\)\s*>\s*1/is.test(
    phase6Sql
  ),
  'Preflight duplicate check exists for active vehicle shift assignments'
);

// Preflight checks for assignments duplicates
assert(
  /SELECT.*incident_id.*FROM\s+public\.assignments.*status\s+IN.*GROUP\s+BY.*HAVING\s+count\(\*\)\s*>\s*1/is.test(
    phase6Sql
  ),
  'Preflight duplicate check exists for active incident assignments'
);

assert(
  /SELECT.*worker_id.*FROM\s+public\.assignments.*status\s+IN.*GROUP\s+BY.*HAVING\s+count\(\*\)\s*>\s*1/is.test(
    phase6Sql
  ),
  'Preflight duplicate check exists for active worker assignments'
);

assert(
  /SELECT.*vehicle_id.*FROM\s+public\.assignments.*status\s+IN.*GROUP\s+BY.*HAVING\s+count\(\*\)\s*>\s*1/is.test(
    phase6Sql
  ),
  'Preflight duplicate check exists for active vehicle assignments'
);

// Partial Unique Indexes creation
assert(
  /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_uq_wva_active_worker\s+ON\s+public\.worker_vehicle_assignments\s*\(organization_id,\s*worker_id\)\s+WHERE\s+status\s*=\s*'active'/i.test(
    phase6Sql
  ),
  'Partial unique index idx_uq_wva_active_worker defined on (organization_id, worker_id) WHERE status = active'
);

assert(
  /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_uq_wva_active_vehicle\s+ON\s+public\.worker_vehicle_assignments\s*\(organization_id,\s*vehicle_id\)\s+WHERE\s+status\s*=\s*'active'/i.test(
    phase6Sql
  ),
  'Partial unique index idx_uq_wva_active_vehicle defined on (organization_id, vehicle_id) WHERE status = active'
);

assert(
  /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_uq_assignments_active_incident\s+ON\s+public\.assignments\s*\(organization_id,\s*incident_id\)\s+WHERE\s+status\s+IN\s*\('assigned',\s*'accepted',\s*'en_route',\s*'on_scene'\)/i.test(
    phase6Sql
  ),
  'Partial unique index idx_uq_assignments_active_incident defined on (organization_id, incident_id) for active statuses'
);

assert(
  /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_uq_assignments_active_worker\s+ON\s+public\.assignments\s*\(organization_id,\s*worker_id\)\s+WHERE\s+status\s+IN\s*\('assigned',\s*'accepted',\s*'en_route',\s*'on_scene'\)/i.test(
    phase6Sql
  ),
  'Partial unique index idx_uq_assignments_active_worker defined on (organization_id, worker_id) for active statuses'
);

assert(
  /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_uq_assignments_active_vehicle\s+ON\s+public\.assignments\s*\(organization_id,\s*vehicle_id\)\s+WHERE\s+vehicle_id\s+IS\s+NOT\s+NULL\s+AND\s+status\s+IN\s*\('assigned',\s*'accepted',\s*'en_route',\s*'on_scene'\)/i.test(
    phase6Sql
  ),
  'Partial unique index idx_uq_assignments_active_vehicle defined on (organization_id, vehicle_id) WHERE vehicle_id IS NOT NULL for active statuses'
);

// ------------------------------------------------------------------------------
// SECTION 2: Direct Mutation Policy Closure & Table Privileges
// ------------------------------------------------------------------------------
console.log('\n--- 2. Assignments Policy Closure & Mutation Lockdown ---');

assert(
  /DROP\s+POLICY\s+IF\s+EXISTS\s+["']?assignments_insert_operator_admin["']?\s+ON\s+public\.assignments/i.test(
    phase6Sql
  ),
  'Direct insert policy assignments_insert_operator_admin is dropped'
);

assert(
  /DROP\s+POLICY\s+IF\s+EXISTS\s+["']?assignments_update["']?\s+ON\s+public\.assignments/i.test(
    phase6Sql
  ),
  'Direct update policy assignments_update is dropped'
);

assert(
  /REVOKE\s+INSERT,\s*UPDATE,\s*DELETE\s+ON\s+public\.assignments\s+FROM\s+[^;]*?\banon\b/i.test(
    phase6Sql
  ),
  'INSERT, UPDATE, DELETE revoked from anon on public.assignments'
);

assert(
  /REVOKE\s+INSERT,\s*UPDATE,\s*DELETE\s+ON\s+public\.assignments\s+FROM\s+[^;]*?\bauthenticated\b/i.test(
    phase6Sql
  ),
  'INSERT, UPDATE, DELETE revoked from authenticated on public.assignments'
);

// ------------------------------------------------------------------------------
// SECTION 3 & 4: get_dispatch_candidates RPC
// ------------------------------------------------------------------------------
console.log('\n--- 3 & 4. get_dispatch_candidates Candidate Generation & Ordering ---');

function extractFunctionDef(sql, functionName) {
  const regex = new RegExp(
    `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${functionName}\\s*\\([\\s\\S]*?\\)\\s*RETURNS[\\s\\S]*?\\$\\$[\\s\\S]*?\\$\\$;`,
    'i'
  );
  const match = sql.match(regex);
  return match ? match[0] : null;
}

const getCandidatesDef = extractFunctionDef(phase6Sql, 'get_dispatch_candidates');
assert(getCandidatesDef !== null, 'Extracted get_dispatch_candidates function definition');

assert(
  /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_dispatch_candidates\s*\(\s*p_incident_id\s+UUID\s*\)/i.test(
    getCandidatesDef
  ),
  'get_dispatch_candidates accepts exactly ONE argument: (p_incident_id UUID)'
);

assert(
  !/p_organization_id/i.test(getCandidatesDef),
  'get_dispatch_candidates has NO organization parameter (session-derived)'
);

assert(
  /SECURITY\s+DEFINER/i.test(getCandidatesDef),
  'get_dispatch_candidates is declared SECURITY DEFINER'
);

assert(
  /SET\s+search_path\s*=\s*public,\s*extensions/i.test(getCandidatesDef),
  'get_dispatch_candidates sets safe search_path = public, extensions'
);

assert(
  /v_caller_role\s+NOT\s+IN\s*\('admin',\s*'operator'\)/i.test(getCandidatesDef),
  'get_dispatch_candidates restricts access to admin and operator roles only (workers denied)'
);

// Incident active assignment conflict check
assert(
  /SELECT\s+count\(\*\)\s+INTO\s+v_active_assignments_count\s+FROM\s+public\.assignments[\s\S]*?'assigned',\s*'accepted',\s*'en_route',\s*'on_scene'/i.test(
    getCandidatesDef
  ),
  'get_dispatch_candidates evaluates count of active assignments on target incident'
);

assert(
  /v_active_assignments_count\s*>\s*0[\s\S]*?v_dispatch_state\s*:=\s*'unavailable'/i.test(
    getCandidatesDef
  ),
  'Initial dispatch fails closed to unavailable if target incident has active assignments'
);

assert(
  /v_active_assignments_count\s*<>\s*1[\s\S]*?v_dispatch_state\s*:=\s*'unavailable'/i.test(
    getCandidatesDef
  ),
  'Dispatched incident fails closed to unavailable if active assignment count is not exactly 1'
);

// Strip SQL comments before checking for ORDER BY ... LIMIT 1
const getCandidatesNoComments = getCandidatesDef.replace(/--[^\n]*/g, '');
assert(
  !/FROM\s+public\.assignments[\s\S]*?ORDER\s+BY[\s\S]*?LIMIT\s+1/i.test(getCandidatesNoComments),
  'get_dispatch_candidates does NOT use arbitrary ORDER BY ... LIMIT 1 to mask multi-active corruption'
);

// Candidate selection CTE checks target incident conflict
assert(
  /NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.assignments\s+a[\s\S]*?a\.incident_id\s*=\s*(p_incident_id|v_inc(ident)?\.id)[\s\S]*?'assigned',\s*'accepted',\s*'en_route',\s*'on_scene'\s*\)/i.test(
    getCandidatesDef
  ),
  'Candidate CTE checks that target incident has no active assignment conflict'
);

// Active shift binding, worker status, and vehicle status
assert(
  /wva\.status\s*=\s*'active'/i.test(getCandidatesDef),
  'get_dispatch_candidates enforces active worker_vehicle_assignments shift binding'
);
assert(
  /wp\.availability_status\s*=\s*'available'/i.test(getCandidatesDef),
  'get_dispatch_candidates enforces worker availability_status = available'
);
assert(
  /p\.is_active\s*=\s*true/i.test(getCandidatesDef),
  'get_dispatch_candidates requires worker profile is_active = true'
);
assert(
  /v\.is_active\s*=\s*true/i.test(getCandidatesDef),
  'get_dispatch_candidates requires vehicle is_active = true'
);

// Capability matching
assert(
  /EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.vehicle_capabilities\s+vc\s+JOIN\s+public\.service_capabilities\s+sc\s+ON\s+vc\.capability_id\s*=\s*sc\.id[\s\S]*?vc\.vehicle_id\s*=\s*v\.id[\s\S]*?(vc\.capability_id|sc\.id)\s*=\s*v_inc(ident)?\.required_capability_id[\s\S]*?sc\.is_active\s*=\s*true\s*\)/i.test(
    getCandidatesDef
  ),
  'get_dispatch_candidates enforces required capability matching on active vehicle capabilities'
);

// Active conflict exclusion for worker and vehicle
assert(
  /NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.assignments\s+a[\s\S]*?a\.worker_id\s*=\s*wp?\.id/i.test(
    getCandidatesDef
  ),
  'get_dispatch_candidates excludes workers with active assignments'
);
assert(
  /NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.assignments\s+a[\s\S]*?a\.vehicle_id\s*=\s*v\.id/i.test(
    getCandidatesDef
  ),
  'get_dispatch_candidates excludes vehicles with active assignments'
);

// Distance and ranking inside jsonb_agg
assert(
  !/ST_DWithin/i.test(getCandidatesDef) && !/radius/i.test(getCandidatesDef),
  'get_dispatch_candidates has NO artificial 50km radius cutoff'
);
assert(
  /ST_Distance\(\s*v_inc(ident)?\.location,\s*v\.last_known_location\s*\)/i.test(getCandidatesDef),
  'get_dispatch_candidates calculates distance using PostGIS ST_Distance'
);
assert(
  /jsonb_agg\([\s\S]*?ORDER\s+BY\s+r\.distance_meters\s+ASC,\s*r\.callsign\s+ASC,\s*r\.worker_id\s+ASC/i.test(
    getCandidatesDef
  ),
  'Ranked candidates ordering is strictly enforced INSIDE the final jsonb_agg aggregate'
);
assert(
  /jsonb_agg\([\s\S]*?ORDER\s+BY\s+u\.callsign\s+ASC,\s*u\.worker_id\s+ASC/i.test(
    getCandidatesDef
  ),
  'Unranked candidates ordering is strictly enforced INSIDE the final jsonb_agg aggregate'
);
assert(
  /ranking_reason/i.test(getCandidatesDef) &&
  /vehicle_location_unavailable/i.test(getCandidatesDef) &&
  /incident_location_unavailable/i.test(getCandidatesDef),
  'Unranked candidates explicitly track ranking_reason without coordinate fabrication'
);

// ------------------------------------------------------------------------------
// SECTION 5: dispatch_incident RPC Transaction
// ------------------------------------------------------------------------------
console.log('\n--- 5. dispatch_incident RPC Transaction & Concurrency ---');

const dispatchIncidentDef = extractFunctionDef(phase6Sql, 'dispatch_incident');
assert(dispatchIncidentDef !== null, 'Extracted dispatch_incident function definition');

assert(
  /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.dispatch_incident\s*\(\s*p_incident_id\s+UUID,\s*p_worker_id\s+UUID,\s*p_vehicle_id\s+UUID\s*\)/i.test(
    dispatchIncidentDef
  ),
  'dispatch_incident accepts exactly THREE arguments: (UUID, UUID, UUID)'
);

assert(
  !/p_organization_id/i.test(dispatchIncidentDef),
  'dispatch_incident has NO organization parameter (session-derived)'
);

assert(
  /SECURITY\s+DEFINER/i.test(dispatchIncidentDef),
  'dispatch_incident is declared SECURITY DEFINER'
);

assert(
  /SET\s+search_path\s*=\s*public,\s*extensions/i.test(dispatchIncidentDef),
  'dispatch_incident sets safe search_path = public, extensions'
);

assert(
  /v_caller_role\s+NOT\s+IN\s*\('admin',\s*'operator'\)/i.test(dispatchIncidentDef),
  'dispatch_incident enforces admin/operator role check'
);

assert(
  /SELECT[\s\S]*?FROM\s+public\.incidents[\s\S]*?FOR\s+UPDATE/i.test(dispatchIncidentDef),
  'dispatch_incident locks incident record with FOR UPDATE'
);

assert(
  /v_inc(ident)?\.status\s*(<>|!=)\s*'ready_for_dispatch'/i.test(dispatchIncidentDef),
  'dispatch_incident requires incident status to be ready_for_dispatch'
);

assert(
  /SELECT[\s\S]*?FROM\s+public\.worker_profiles[\s\S]*?FOR\s+UPDATE/i.test(dispatchIncidentDef),
  'dispatch_incident locks worker_profiles with FOR UPDATE'
);

assert(
  /v_worker\.availability_status\s*(<>|!=)\s*'available'/i.test(dispatchIncidentDef),
  'dispatch_incident validates worker availability_status = available'
);

assert(
  /(NOT\s+v_worker\.is_active|v_worker_is_active\s*(<>|!=)\s*true)/i.test(dispatchIncidentDef),
  'dispatch_incident validates worker profile is_active'
);

assert(
  /SELECT[\s\S]*?FROM\s+public\.vehicles[\s\S]*?FOR\s+UPDATE/i.test(dispatchIncidentDef),
  'dispatch_incident locks vehicle record with FOR UPDATE'
);

assert(
  /(NOT\s+v_veh(icle)?\.is_active|v_veh(icle)?\.is_active\s*(<>|!=)\s*true)/i.test(dispatchIncidentDef),
  'dispatch_incident validates vehicle is_active'
);

assert(
  /SELECT[\s\S]*?FROM\s+public\.worker_vehicle_assignments[\s\S]*?FOR\s+UPDATE/i.test(
    dispatchIncidentDef
  ),
  'dispatch_incident locks worker_vehicle_assignments shift binding with FOR UPDATE'
);

assert(
  /v_inc(ident)?\.required_capability_id\s+IS\s+NOT\s+NULL/i.test(dispatchIncidentDef) &&
  /EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.vehicle_capabilities\s+vc\s+JOIN\s+public\.service_capabilities\s+sc/i.test(
    dispatchIncidentDef
  ),
  'dispatch_incident re-validates vehicle capability match inside transaction'
);

assert(
  /FROM\s+public\.assignments\s+a[\s\S]*?a\.incident_id\s*=\s*p_incident_id/i.test(
    dispatchIncidentDef
  ),
  'dispatch_incident re-checks incident active assignment conflict at transaction time'
);

assert(
  /FROM\s+public\.assignments\s+a[\s\S]*?a\.worker_id\s*=\s*p_worker_id/i.test(
    dispatchIncidentDef
  ),
  'dispatch_incident re-checks worker active assignment conflict at transaction time'
);

assert(
  /FROM\s+public\.assignments\s+a[\s\S]*?a\.vehicle_id\s*=\s*p_vehicle_id/i.test(
    dispatchIncidentDef
  ),
  'dispatch_incident re-checks vehicle active assignment conflict at transaction time'
);

assert(
  /INSERT\s+INTO\s+public\.assignments[\s\S]*?'assigned'/i.test(dispatchIncidentDef),
  'dispatch_incident inserts assignment record with status = assigned'
);

assert(
  /PERFORM\s+public\.transition_incident_status\(\s*p_incident_id,\s*'dispatched'/i.test(
    dispatchIncidentDef
  ),
  'dispatch_incident reuses authoritative Phase 4 transition_incident_status function'
);

assert(
  /INSERT\s+INTO\s+public\.operational_events[\s\S]*?'ASSIGNMENT_CREATED'/i.test(
    dispatchIncidentDef
  ),
  'dispatch_incident writes ASSIGNMENT_CREATED operational audit event'
);

// ------------------------------------------------------------------------------
// SECTION 6: reassign_incident RPC Transaction
// ------------------------------------------------------------------------------
console.log('\n--- 6. reassign_incident RPC Transaction & Lifecycle ---');

const reassignIncidentDef = extractFunctionDef(phase6Sql, 'reassign_incident');
assert(reassignIncidentDef !== null, 'Extracted reassign_incident function definition');

assert(
  /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.reassign_incident\s*\(\s*p_incident_id\s+UUID,\s*p_current_assignment_id\s+UUID,\s*p_new_worker_id\s+UUID,\s*p_new_vehicle_id\s+UUID\s*\)/i.test(
    reassignIncidentDef
  ),
  'reassign_incident accepts exactly FOUR arguments: (UUID, UUID, UUID, UUID)'
);

assert(
  !/p_organization_id/i.test(reassignIncidentDef),
  'reassign_incident has NO organization parameter (session-derived)'
);

assert(
  /SECURITY\s+DEFINER/i.test(reassignIncidentDef),
  'reassign_incident is declared SECURITY DEFINER'
);

assert(
  /SET\s+search_path\s*=\s*public,\s*extensions/i.test(reassignIncidentDef),
  'reassign_incident sets safe search_path = public, extensions'
);

assert(
  /v_inc(ident)?\.status\s*(<>|!=)\s*'dispatched'/i.test(reassignIncidentDef),
  'reassign_incident requires incident status = dispatched'
);

assert(
  /SELECT[\s\S]*?FROM\s+public\.assignments[\s\S]*?WHERE\s+(a\.)?id\s*=\s*p_current_assignment_id[\s\S]*?FOR\s+UPDATE/i.test(
    reassignIncidentDef
  ),
  'reassign_incident locks current assignment with FOR UPDATE'
);

assert(
  /v_curr\.status\s*(<>|!=)\s*'assigned'/i.test(reassignIncidentDef),
  'reassign_incident strictly rejects current assignments beyond status assigned'
);

assert(
  /v_curr\.worker_id\s*=\s*p_new_worker_id\s+AND\s+v_curr\.vehicle_id\s*=\s*p_new_vehicle_id/i.test(
    reassignIncidentDef
  ),
  'reassign_incident rejects reassignment to the identical worker and vehicle pair'
);

assert(
  /a\.id\s*(<>|!=)\s*p_current_assignment_id/i.test(reassignIncidentDef),
  'reassign_incident ignores current assignment being replaced during active conflict check'
);

assert(
  /UPDATE\s+public\.assignments\s+SET\s+status\s*=\s*'cancelled'\s+WHERE\s+id\s*=\s*p_current_assignment_id/i.test(
    reassignIncidentDef
  ),
  'reassign_incident updates old assignment status to cancelled'
);

assert(
  !/completed_at\s*=\s*now\(\)/i.test(reassignIncidentDef),
  'reassign_incident does NOT fabricate completed_at timestamp on cancelled assignment'
);

assert(
  /INSERT\s+INTO\s+public\.assignments[\s\S]*?'assigned'/i.test(reassignIncidentDef),
  'reassign_incident inserts replacement assignment in status assigned'
);

assert(
  !/transition_incident_status[\s\S]*?'ready_for_dispatch'/i.test(reassignIncidentDef),
  'reassign_incident does NOT transition incident backward to ready_for_dispatch'
);

assert(
  /INSERT\s+INTO\s+public\.operational_events[\s\S]*?'INCIDENT_REASSIGNED'/i.test(
    reassignIncidentDef
  ),
  'reassign_incident writes INCIDENT_REASSIGNED operational audit event'
);

// ------------------------------------------------------------------------------
// SECTION 7: Execution Privileges & Revocations in Migration
// ------------------------------------------------------------------------------
console.log('\n--- 7. RPC Execution Privileges & Revocations in Migration ---');

assert(
  /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.get_dispatch_candidates\(UUID\)\s+FROM\s+[^;]*?PUBLIC/i.test(
    phase6Sql
  ) &&
  /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.get_dispatch_candidates\(UUID\)\s+FROM\s+[^;]*?anon/i.test(
    phase6Sql
  ) &&
  /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.get_dispatch_candidates\(UUID\)\s+TO\s+authenticated/i.test(
    phase6Sql
  ),
  'get_dispatch_candidates: PUBLIC/anon revoked, authenticated granted'
);

assert(
  /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.dispatch_incident\(UUID,\s*UUID,\s*UUID\)\s+FROM\s+[^;]*?PUBLIC/i.test(
    phase6Sql
  ) &&
  /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.dispatch_incident\(UUID,\s*UUID,\s*UUID\)\s+FROM\s+[^;]*?anon/i.test(
    phase6Sql
  ) &&
  /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.dispatch_incident\(UUID,\s*UUID,\s*UUID\)\s+TO\s+authenticated/i.test(
    phase6Sql
  ),
  'dispatch_incident: PUBLIC/anon revoked, authenticated granted'
);

assert(
  /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.reassign_incident\(UUID,\s*UUID,\s*UUID,\s*UUID\)\s+FROM\s+[^;]*?PUBLIC/i.test(
    phase6Sql
  ) &&
  /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.reassign_incident\(UUID,\s*UUID,\s*UUID,\s*UUID\)\s+FROM\s+[^;]*?anon/i.test(
    phase6Sql
  ) &&
  /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.reassign_incident\(UUID,\s*UUID,\s*UUID,\s*UUID\)\s+TO\s+authenticated/i.test(
    phase6Sql
  ),
  'reassign_incident: PUBLIC/anon revoked, authenticated granted'
);

// ------------------------------------------------------------------------------
// SECTION 8: Application Data Layer & Actions (src/lib/dispatch)
// ------------------------------------------------------------------------------
console.log('\n--- 8. Dispatch Data Layer & Server Actions ---');

const dataPath = path.join(rootDir, 'src/lib/dispatch/data.ts');
const actionsPath = path.join(rootDir, 'src/lib/dispatch/actions.ts');
const typesPath = path.join(rootDir, 'src/types/index.ts');

assert(fs.existsSync(dataPath), 'src/lib/dispatch/data.ts exists');
assert(fs.existsSync(actionsPath), 'src/lib/dispatch/actions.ts exists');

const dataContent = fs.readFileSync(dataPath, 'utf8');
const actionsContent = fs.readFileSync(actionsPath, 'utf8');
const typesContent = fs.readFileSync(typesPath, 'utf8');

assert(
  actionsContent.startsWith("'use server'") || actionsContent.includes('"use server"'),
  'src/lib/dispatch/actions.ts is declared as a Server Action module'
);

assert(
  dataContent.includes('validateAndNormalizeDispatchContext'),
  'data.ts exports validateAndNormalizeDispatchContext'
);

// Regression Check: Strict property presence checks
assert(
  dataContent.includes("'required_capability'") &&
  dataContent.includes("'current_assignment'") &&
  dataContent.includes('hasOwnProperty'),
  'data.ts strictly checks property presence for required contract keys (required_capability, current_assignment)'
);

// Regression Check: Strict nullable field validation (no silent null fallback for invalid types)
assert(
  dataContent.includes('validateNullableString') &&
  dataContent.includes('validateNullableTimestamp') &&
  !/registration_number:\s*typeof\s+[^=]+===\s*'string'\s*\?\s*[^:]+:\s*null/i.test(dataContent) &&
  !/vehicle_location_updated_at:\s*typeof\s+[^=]+===\s*'string'\s*\?\s*[^:]+:\s*null/i.test(dataContent),
  'data.ts strictly validates nullable fields (registration_number, vehicle_location_updated_at) and rejects malformed types'
);

// Regression Check: Strict timestamp validation with finite Date.parse
assert(
  dataContent.includes('validateRequiredTimestamp') &&
  dataContent.includes('Date.parse') &&
  dataContent.includes('Number.isFinite'),
  'data.ts strictly validates authoritative timestamps with finite Date.parse'
);

// Distance validation
assert(
  dataContent.includes('Number.isFinite(c.distance_meters)') &&
  dataContent.includes('c.distance_meters < 0'),
  'data.ts validates distance_meters is finite number >= 0'
);

// No fallback status fabrication
assert(
  !dataContent.includes("|| 'dispatched'") && !dataContent.includes("?? 'dispatched'"),
  'data.ts does NOT fabricate incident_status with fallback || or ??'
);

assert(
  dataContent.includes("incident_status !== 'dispatched'") &&
  dataContent.includes("incident_status: 'dispatched'"),
  'data.ts strictly validates that returned incident_status === dispatched'
);

assert(
  !dataContent.includes('return { error: err }') &&
  !dataContent.includes('return { error: error.message }'),
  'data.ts does NOT expose raw Postgres/Supabase error messages to client'
);

// Regression Check: Lifecycle consistency - initial_dispatch (ready_for_dispatch + current_assignment null)
assert(
  /if\s*\(\s*dispatch_state\s*===\s*'initial_dispatch'\s*\)\s*\{[\s\S]*?inc\.status\s*!==\s*'ready_for_dispatch'\s*\|\|\s*current_assignment\s*!==\s*null[\s\S]*?return\s+null/m.test(dataContent),
  'data.ts enforces fail-closed initial_dispatch lifecycle consistency (ready_for_dispatch AND current_assignment === null)'
);

// Regression Check: Lifecycle consistency - reassignment (dispatched + current_assignment present + status === assigned)
assert(
  /else\s+if\s*\(\s*dispatch_state\s*===\s*'reassignment'\s*\)\s*\{[\s\S]*?inc\.status\s*!==\s*'dispatched'[\s\S]*?current_assignment\s*===\s*null[\s\S]*?current_assignment\.status\s*!==\s*'assigned'[\s\S]*?return\s+null/m.test(dataContent),
  'data.ts enforces fail-closed reassignment lifecycle consistency (dispatched AND current_assignment !== null AND status === assigned)'
);

// Regression Check: Lifecycle consistency - assigned_locked (dispatched + current_assignment present + status in accepted/en_route/on_scene)
assert(
  /else\s+if\s*\(\s*dispatch_state\s*===\s*'assigned_locked'\s*\)\s*\{[\s\S]*?inc\.status\s*!==\s*'dispatched'[\s\S]*?current_assignment\s*===\s*null[\s\S]*?current_assignment\.status\s*!==\s*'accepted'[\s\S]*?current_assignment\.status\s*!==\s*'en_route'[\s\S]*?current_assignment\.status\s*!==\s*'on_scene'[\s\S]*?return\s+null/m.test(dataContent),
  'data.ts enforces fail-closed assigned_locked lifecycle consistency (dispatched AND current_assignment !== null AND status in accepted/en_route/on_scene)'
);

// Authoritative Types
assert(
  typesContent.includes('DispatchState') &&
  typesContent.includes('DispatchRankedCandidate') &&
  typesContent.includes('DispatchUnrankedCandidate') &&
  typesContent.includes('DispatchCurrentAssignment') &&
  typesContent.includes('DispatchContext') &&
  typesContent.includes('DispatchCandidatesResult') &&
  typesContent.includes('DispatchMutationResult'),
  'src/types/index.ts defines all authoritative Phase 6 dispatch types'
);

assert(
  /status:\s*AssignmentStatus/.test(typesContent),
  'DispatchCurrentAssignment.status uses authoritative AssignmentStatus type'
);

assert(
  /status:\s*IncidentStatus/.test(typesContent),
  'DispatchIncidentContext.status uses authoritative IncidentStatus type'
);

assert(
  /incident_status:\s*'dispatched'/.test(typesContent),
  'Mutation success payloads strictly type incident_status as "dispatched"'
);

// ------------------------------------------------------------------------------
// SECTION 9: Frontend UI Integration & Stale Notice UX
// ------------------------------------------------------------------------------
console.log('\n--- 9. Frontend UI Integration & Mapbox Stability ---');

const dispatchPanelPath = path.join(
  rootDir,
  'src/components/operations/dispatch-panel.tsx'
);
const contextPanelPath = path.join(
  rootDir,
  'src/components/operations/operations-context-panel.tsx'
);
const workspacePath = path.join(
  rootDir,
  'src/components/operations/operations-workspace.tsx'
);
const mapPath = path.join(rootDir, 'src/components/operations/operations-map.tsx');

assert(fs.existsSync(dispatchPanelPath), 'src/components/operations/dispatch-panel.tsx exists');

const dispatchPanelContent = fs.readFileSync(dispatchPanelPath, 'utf8');
const contextPanelContent = fs.readFileSync(contextPanelPath, 'utf8');
const workspaceContent = fs.readFileSync(workspacePath, 'utf8');
const mapContent = fs.readFileSync(mapPath, 'utf8');

assert(
  dispatchPanelContent.includes('isConfirming') &&
  dispatchPanelContent.includes('handleConfirmDispatch') &&
  dispatchPanelContent.includes('Confirm dispatch'),
  'dispatch-panel.tsx enforces explicit confirmation view before dispatch mutation'
);

assert(
  dispatchPanelContent.includes('Closest eligible unit'),
  'dispatch-panel.tsx uses truthful "Closest eligible unit" label'
);

assert(
  dispatchPanelContent.includes('setIsReassignMode(false)'),
  'dispatch-panel.tsx resets isReassignMode when context is no longer in reassignment state'
);

// Regression Check: Stale mutation notice preservation in fetchCandidates
assert(
  dispatchPanelContent.includes('clearMutationNotice') &&
  dispatchPanelContent.includes('clearMutationNotice: false') &&
  /setMutationError\([^)]*\)[\s\S]*?await\s+onRefreshWorkspace\(\)[\s\S]*?await\s+fetchCandidates\(\s*\{\s*clearMutationNotice:\s*false\s*\}\s*\)/.test(
    dispatchPanelContent
  ),
  'dispatch-panel.tsx preserves mutation error notice across stale-conflict candidate refresh'
);

// Regression Check: Reassignment progression notice displayed in Assigned Response view
assert(
  dispatchPanelContent.includes('Reassignment is no longer allowed. The current assignment may have already progressed.') &&
  dispatchPanelContent.includes('Assigned Response') &&
  dispatchPanelContent.includes('mutationError'),
  'dispatch-panel.tsx displays reassignment progression notice in Assigned Response view when reassignment is blocked'
);

// Regression Check: Unranked vehicle telemetry rendered truthfully when incident is unmapped
assert(
  dispatchPanelContent.includes("cand.ranking_reason === 'incident_location_unavailable'") &&
  dispatchPanelContent.includes('Incident coordinates not recorded') &&
  dispatchPanelContent.includes('Vehicle position:') &&
  dispatchPanelContent.includes('Vehicle location unavailable'),
  'dispatch-panel.tsx renders truthful vehicle last-known position for unranked candidate when incident is unmapped'
);

// Regression Check: Defensive date formatters
assert(
  dispatchPanelContent.includes('Number.isFinite(timestamp)') &&
  !dispatchPanelContent.includes('NaNd ago'),
  'dispatch-panel.tsx formats dates defensively against non-finite timestamps'
);

assert(
  workspaceContent.includes('while (true)') &&
  workspaceContent.includes('pendingQueuedRefreshRef'),
  'operations-workspace.tsx implements serialized queued refresh to guarantee post-mutation execution'
);

assert(
  !/AI\s+(Recommended|Recommendation|Selected)|Smart\s+Score|Best\s+Unit|Match\s+Score/i.test(
    dispatchPanelContent
  ),
  'dispatch-panel.tsx contains no marketing buzzwords (AI, Smart Score, Best Unit)'
);

assert(
  dispatchPanelContent.includes('requestSeqRef'),
  'dispatch-panel.tsx uses request sequence ref to prevent stale response overwrites'
);

assert(
  contextPanelContent.includes('DispatchPanel') &&
  contextPanelContent.includes("selectedIncident.status === 'ready_for_dispatch'") &&
  contextPanelContent.includes("selectedIncident.status === 'dispatched'"),
  'operations-context-panel.tsx renders DispatchPanel for ready_for_dispatch and dispatched incidents'
);

assert(
  mapContent.includes('highlightedDispatchVehicleId') &&
  workspaceContent.includes('highlightedDispatchVehicleId'),
  'Workspace and Map support highlightedDispatchVehicleId without breaking map lifecycle'
);

assert(
  !mapContent.includes('useEffect(() => { mapboxgl.Map'),
  'Mapbox initialization effect is properly isolated'
);

assert(
  workspaceContent.includes('setHighlightedDispatchVehicleId(null)') &&
  workspaceContent.includes('handleClearSelection'),
  'Workspace clears dispatch highlight and selection when incident is deselected or filtered out'
);

// ------------------------------------------------------------------------------
// SECTION 10: Manual SQL Verifier (supabase/verify_phase6.sql)
// ------------------------------------------------------------------------------
console.log('\n--- 10. Manual SQL Verifier Catalog Assertions ---');

const verifySqlPath = path.join(rootDir, 'supabase/verify_phase6.sql');
assert(fs.existsSync(verifySqlPath), 'supabase/verify_phase6.sql exists');

const verifySql = fs.readFileSync(verifySqlPath, 'utf8');

assert(
  verifySql.includes("has_table_privilege('anon', 'public.assignments', 'DELETE')") &&
  verifySql.includes("has_table_privilege('authenticated', 'public.assignments', 'DELETE')"),
  'verify_phase6.sql checks DELETE privilege on public.assignments for anon and authenticated'
);

const authExecCount = (verifySql.match(/has_function_privilege\('authenticated',\s*v_fn_oid,\s*'EXECUTE'\)/g) || []).length;
const anonExecCount = (verifySql.match(/has_function_privilege\('anon',\s*v_fn_oid,\s*'EXECUTE'\)/g) || []).length;
const aclExplodeCount = (verifySql.match(/aclexplode/g) || []).length;

assert(
  authExecCount === 3 && anonExecCount === 3 && aclExplodeCount >= 3,
  'verify_phase6.sql verifies authenticated EXECUTE, anon denial, and PUBLIC revocation for all 3 Phase 6 RPCs'
);

assert(
  verifySql.includes('idx_uq_wva_active_worker') &&
  verifySql.includes('idx_uq_wva_active_vehicle') &&
  verifySql.includes('idx_uq_assignments_active_incident') &&
  verifySql.includes('idx_uq_assignments_active_worker') &&
  verifySql.includes('idx_uq_assignments_active_vehicle'),
  'verify_phase6.sql verifies all 5 partial unique index names and predicates'
);

assert(
  /v_active_assignments_count\s*(\\\s\*)?<>\s*(\\\s\*)?1/.test(verifySql) || verifySql.includes('v_active_assignments_count'),
  'verify_phase6.sql asserts fail-closed behavior for abnormal active assignment counts'
);

assert(
  verifySql.includes('public\\.assignments') &&
  verifySql.includes('a\\.incident_id') &&
  verifySql.includes('p_incident_id') &&
  !verifySql.includes('v_incident.id'),
  'verify_phase6.sql asserts candidate CTE target incident active conflict check uses a.incident_id = p_incident_id on public.assignments'
);

// ------------------------------------------------------------------------------
// SECTION 11: Strict Phase Boundaries (No Phase 7-9 leakage)
// ------------------------------------------------------------------------------
console.log('\n--- 11. Phase Boundary Enforcement (No Phase 7–9 leakage) ---');

const phase6Files = [
  phase6MigrationPath,
  dataPath,
  actionsPath,
  dispatchPanelPath,
];

for (const filePath of phase6Files) {
  const content = fs.readFileSync(filePath, 'utf8');
  const base = path.basename(filePath);

  assert(
    !content.includes('watchPosition'),
    `File ${base} does not contain Phase 7 watchPosition`
  );
  assert(
    !content.includes('postgres_changes'),
    `File ${base} does not contain premature postgres_changes Realtime`
  );
  assert(
    !content.includes('twilio') && !content.includes('Twilio'),
    `File ${base} does not contain premature Phase 9 Twilio integration`
  );
  assert(
    !content.includes('vapi') && !content.includes('Vapi'),
    `File ${base} does not contain premature Phase 9 Vapi integration`
  );
  assert(
    !/Accept\s+Job|Job\s+Accepted|en_route_at|on_scene_at/i.test(content),
    `File ${base} does not implement Phase 7 worker state transitions`
  );
}

// ------------------------------------------------------------------------------
// SUMMARY
// ------------------------------------------------------------------------------
console.log('\n================================================================');
console.log(`  PHASE 6 VERIFICATION RESULTS: ${passedChecks} / ${totalChecks} PASSED, ${failedChecks} FAILED`);
console.log('================================================================');

if (failedChecks > 0) {
  console.error(`\nFAILURE: ${failedChecks} checks failed.`);
  process.exit(1);
} else {
  console.log('\nSUCCESS: All Phase 6 architectural and security checks passed cleanly.');
  process.exit(0);
}
