/**
 * Phase 7A Response Worker Lifecycle & Database Foundation Verification Suite
 *
 * Verifies:
 * 1. Migration ordering after Phase 6
 * 2. Schema hygiene: zero new tables, no invented assignment statuses
 * 3. Authoritative worker RPC signature, SECURITY DEFINER, search_path, session-derived identity
 * 4. Concurrency row locking on assignment and incident (FOR UPDATE)
 * 5. Exact 5 worker actions: ACCEPT_ASSIGNMENT, START_JOURNEY, ARRIVE_ON_SCENE, START_WORK, COMPLETE_JOB
 * 6. Exact transition rules, no state skipping, completed_at ONLY on COMPLETE_JOB
 * 7. Worker availability transitions: accepted -> busy, completed -> available
 * 8. Phase 4 transition_incident_status reuse without trigger bypass
 * 9. Exact 5 operational audit event types
 * 10. RPC privileges: PUBLIC/anon revoked, authenticated granted
 * 11. Application data layer (assignment-data.ts): fail-closed property presence, vehicle relationships, lifecycle pair consistency, no fabrication, no location_description
 * 12. Server action (actions.ts): 'use server' export safety, private constants, authoritative runtime enum validation, action-consistent invariants
 * 13. Authoritative types in src/types/index.ts: WorkerActiveAssignment without location_description
 * 14. Phase boundaries: zero GPS, zero Realtime, zero service worker, zero Twilio/Vapi
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

let totalChecks = 0;
let passedChecks = 0;

function assert(condition, message) {
  totalChecks++;
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  }
  passedChecks++;
  console.log(`[PASS] ${message}`);
}

console.log('================================================================');
console.log('  MATOS SYSTEMS — PHASE 7A WORKER LIFECYCLE VERIFICATION');
console.log('================================================================\n');

// ------------------------------------------------------------------------------
// SECTION 1: Migration Ordering & Schema Hygiene
// ------------------------------------------------------------------------------
console.log('--- 1. Migration Ordering & Schema Hygiene ---');

const migrationsDir = path.join(rootDir, 'supabase/migrations');
const migrationFiles = fs.readdirSync(migrationsDir).sort();

const phase6Migration = '20260930060000_phase6_dispatch_engine.sql';
const phase7Migration = '20260930160000_phase7_worker_lifecycle.sql';

assert(migrationFiles.includes(phase6Migration), 'Phase 6 migration exists in repository');
assert(migrationFiles.includes(phase7Migration), 'Phase 7A migration exists in repository');
assert(
  migrationFiles.indexOf(phase7Migration) > migrationFiles.indexOf(phase6Migration),
  'Phase 7A migration sorts sequentially after Phase 6 migration'
);

const phase7SqlPath = path.join(migrationsDir, phase7Migration);
const phase7Sql = fs.readFileSync(phase7SqlPath, 'utf8');

assert(!/CREATE\s+TABLE/i.test(phase7Sql), 'Phase 7A creates zero new database tables (hygiene)');
assert(
  !/status\s*=\s*'in_progress'/i.test(phase7Sql.replace(/incidents[\s\S]+?status\s*=\s*'in_progress'/i, '')),
  'Phase 7A does NOT invent an assignment status named in_progress'
);

// ------------------------------------------------------------------------------
// SECTION 2: Worker RPC Signature & Configuration
// ------------------------------------------------------------------------------
console.log('\n--- 2. Worker RPC Signature & Configuration ---');

assert(
  phase7Sql.includes('CREATE OR REPLACE FUNCTION public.worker_transition_assignment'),
  'worker_transition_assignment function is declared in Phase 7A migration'
);

const rpcSignatureMatch = phase7Sql.match(
  /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.worker_transition_assignment\s*\(\s*p_assignment_id\s+UUID\s*,\s*p_action\s+TEXT\s*\)\s*RETURNS\s+JSONB/i
);
assert(rpcSignatureMatch !== null, 'worker_transition_assignment has exact signature: (UUID, TEXT) RETURNS JSONB');

// Extract RPC body
const rpcBodyMatch = phase7Sql.match(
  /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.worker_transition_assignment[\s\S]+?\$\$([\s\S]+?)\$\$;/i
);
assert(rpcBodyMatch !== null, 'Extracted worker_transition_assignment body');
const rpcBody = rpcBodyMatch[1];

assert(rpcBodyMatch[0].includes('SECURITY DEFINER'), 'worker_transition_assignment is declared SECURITY DEFINER');
assert(
  rpcBodyMatch[0].includes('SET search_path = public, extensions'),
  'worker_transition_assignment sets safe search_path = public, extensions'
);

// Session context & worker role enforcement
assert(
  rpcBody.includes('v_caller_uid := auth.uid()') && rpcBody.includes('v_caller_uid IS NULL'),
  'worker_transition_assignment requires authenticated session (auth.uid)'
);

assert(
  rpcBody.includes('public.worker_profiles wp ON wp.user_id = p.id') &&
  rpcBody.includes('wp.organization_id = p.organization_id'),
  'worker_transition_assignment resolves worker_profile identity strictly through authenticated profile'
);

assert(
  rpcBody.includes("v_caller_role != 'worker'") || rpcBody.includes("v_caller_role <> 'worker'"),
  'worker_transition_assignment strictly restricts caller role to worker (admins/operators rejected)'
);

assert(
  rpcBody.includes('v_profile_active') && rpcBody.includes('Profile is deactivated'),
  'worker_transition_assignment validates profile is active'
);

assert(
  !rpcBody.match(/p_organization_id/i) && !rpcBody.match(/p_worker_id/i),
  'worker_transition_assignment accepts NO organization_id or worker_id parameters from client'
);

// ------------------------------------------------------------------------------
// SECTION 3: Concurrency Row Locking & Ownership Checks
// ------------------------------------------------------------------------------
console.log('\n--- 3. Concurrency Row Locking & Ownership Checks ---');

assert(
  /SELECT[\s\S]+?FROM\s+public\.assignments\s+a[\s\S]+?FOR\s+UPDATE/i.test(rpcBody),
  'worker_transition_assignment locks target assignment record with FOR UPDATE'
);

assert(
  /SELECT[\s\S]+?FROM\s+public\.incidents\s+inc[\s\S]+?FOR\s+UPDATE/i.test(rpcBody),
  'worker_transition_assignment locks target incident record with FOR UPDATE'
);

assert(
  rpcBody.includes('v_assignment.organization_id != v_caller_org') ||
  rpcBody.includes('v_assignment.organization_id <> v_caller_org'),
  'worker_transition_assignment verifies assignment tenant organization matches caller organization'
);

assert(
  rpcBody.includes('v_assignment.worker_id != v_worker_id') ||
  rpcBody.includes('v_assignment.worker_id <> v_worker_id'),
  'worker_transition_assignment strictly verifies assignment is bound to caller worker profile'
);

// ------------------------------------------------------------------------------
// SECTION 4: Exact 5 Action Transitions & Invariants
// ------------------------------------------------------------------------------
console.log('\n--- 4. Exact 5 Action Transitions & Invariants ---');

const actions = [
  'ACCEPT_ASSIGNMENT',
  'START_JOURNEY',
  'ARRIVE_ON_SCENE',
  'START_WORK',
  'COMPLETE_JOB',
];

for (const act of actions) {
  assert(rpcBody.includes(`'${act}'`), `worker_transition_assignment handles action ${act}`);
}

// ACTION 1: ACCEPT_ASSIGNMENT
assert(
  /WHEN\s+'ACCEPT_ASSIGNMENT'\s+THEN[\s\S]*?v_assignment\.status\s*!=\s*'assigned'[\s\S]*?v_incident\.status\s*!=\s*'dispatched'/i.test(rpcBody),
  'ACCEPT_ASSIGNMENT requires assignment=assigned AND incident=dispatched'
);
assert(
  /WHEN\s+'ACCEPT_ASSIGNMENT'\s+THEN[\s\S]*?UPDATE\s+public\.assignments\s+SET\s+status\s*=\s*'accepted'/i.test(rpcBody),
  'ACCEPT_ASSIGNMENT transitions assignment to accepted'
);
assert(
  /WHEN\s+'ACCEPT_ASSIGNMENT'\s+THEN[\s\S]*?UPDATE\s+public\.worker_profiles\s+SET\s+availability_status\s*=\s*'busy'/i.test(rpcBody),
  'ACCEPT_ASSIGNMENT sets worker_profiles.availability_status to busy'
);

// ACTION 2: START_JOURNEY
assert(
  /WHEN\s+'START_JOURNEY'\s+THEN[\s\S]*?v_assignment\.status\s*!=\s*'accepted'[\s\S]*?v_incident\.status\s*!=\s*'dispatched'/i.test(rpcBody),
  'START_JOURNEY requires assignment=accepted AND incident=dispatched'
);
assert(
  /WHEN\s+'START_JOURNEY'\s+THEN[\s\S]*?UPDATE\s+public\.assignments\s+SET\s+status\s*=\s*'en_route'/i.test(rpcBody),
  'START_JOURNEY transitions assignment to en_route'
);
assert(
  /WHEN\s+'START_JOURNEY'\s+THEN[\s\S]*?public\.transition_incident_status\([\s\S]*?'en_route'/i.test(rpcBody),
  'START_JOURNEY transitions incident to en_route via transition_incident_status'
);

// ACTION 3: ARRIVE_ON_SCENE
assert(
  /WHEN\s+'ARRIVE_ON_SCENE'\s+THEN[\s\S]*?v_assignment\.status\s*!=\s*'en_route'[\s\S]*?v_incident\.status\s*!=\s*'en_route'/i.test(rpcBody),
  'ARRIVE_ON_SCENE requires assignment=en_route AND incident=en_route'
);
assert(
  /WHEN\s+'ARRIVE_ON_SCENE'\s+THEN[\s\S]*?UPDATE\s+public\.assignments\s+SET\s+status\s*=\s*'on_scene'/i.test(rpcBody),
  'ARRIVE_ON_SCENE transitions assignment to on_scene'
);
assert(
  /WHEN\s+'ARRIVE_ON_SCENE'\s+THEN[\s\S]*?public\.transition_incident_status\([\s\S]*?'on_scene'/i.test(rpcBody),
  'ARRIVE_ON_SCENE transitions incident to on_scene via transition_incident_status'
);

// ACTION 4: START_WORK
assert(
  /WHEN\s+'START_WORK'\s+THEN[\s\S]*?v_assignment\.status\s*!=\s*'on_scene'[\s\S]*?v_incident\.status\s*!=\s*'on_scene'/i.test(rpcBody),
  'START_WORK requires assignment=on_scene AND incident=on_scene'
);
assert(
  /WHEN\s+'START_WORK'\s+THEN[\s\S]*?public\.transition_incident_status\([\s\S]*?'in_progress'/i.test(rpcBody),
  'START_WORK transitions incident to in_progress via transition_incident_status'
);
const startWorkBlock = rpcBody.match(/WHEN\s+'START_WORK'\s+THEN([\s\S]+?)WHEN\s+'COMPLETE_JOB'/i)?.[1] || '';
assert(
  !/UPDATE\s+public\.assignments/i.test(startWorkBlock),
  'START_WORK does NOT mutate assignment status (remains on_scene)'
);

// ACTION 5: COMPLETE_JOB
assert(
  /WHEN\s+'COMPLETE_JOB'\s+THEN[\s\S]*?v_assignment\.status\s*!=\s*'on_scene'[\s\S]*?v_incident\.status\s*!=\s*'in_progress'/i.test(rpcBody),
  'COMPLETE_JOB requires assignment=on_scene AND incident=in_progress'
);
assert(
  /WHEN\s+'COMPLETE_JOB'\s+THEN[\s\S]*?UPDATE\s+public\.assignments\s+SET\s+status\s*=\s*'completed',\s*completed_at\s*=\s*v_completed_at/i.test(rpcBody),
  'COMPLETE_JOB transitions assignment to completed and sets completed_at'
);
assert(
  /WHEN\s+'COMPLETE_JOB'\s+THEN[\s\S]*?UPDATE\s+public\.worker_profiles\s+SET\s+availability_status\s*=\s*'available'/i.test(rpcBody),
  'COMPLETE_JOB sets worker_profiles.availability_status to available'
);
assert(
  /WHEN\s+'COMPLETE_JOB'\s+THEN[\s\S]*?public\.transition_incident_status\([\s\S]*?'completed'/i.test(rpcBody),
  'COMPLETE_JOB transitions incident to completed via transition_incident_status'
);

// Verify completed_at is ONLY set in COMPLETE_JOB block (strip SQL comments first)
const stripComments = (str) => str.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

const nonCompleteBlocks = [
  rpcBody.match(/WHEN\s+'ACCEPT_ASSIGNMENT'\s+THEN([\s\S]+?)WHEN\s+'START_JOURNEY'/i)?.[1] || '',
  rpcBody.match(/WHEN\s+'START_JOURNEY'\s+THEN([\s\S]+?)WHEN\s+'ARRIVE_ON_SCENE'/i)?.[1] || '',
  rpcBody.match(/WHEN\s+'ARRIVE_ON_SCENE'\s+THEN([\s\S]+?)WHEN\s+'START_WORK'/i)?.[1] || '',
  rpcBody.match(/WHEN\s+'START_WORK'\s+THEN([\s\S]+?)WHEN\s+'COMPLETE_JOB'/i)?.[1] || '',
];

for (const b of nonCompleteBlocks) {
  const codeOnly = stripComments(b);
  assert(!codeOnly.includes('completed_at'), 'completed_at timestamp is NOT set outside of COMPLETE_JOB');
}

// ------------------------------------------------------------------------------
// SECTION 5: Phase 4 State Machine Integration & Operational Events
// ------------------------------------------------------------------------------
console.log('\n--- 5. Phase 4 State Machine Integration & Operational Events ---');

assert(
  phase7Sql.includes('matos.authorized_worker_transition'),
  'Phase 7A migration uses transaction-local matos.authorized_worker_transition GUC flag'
);

assert(
  phase7Sql.includes('matos.authorized_status_transition'),
  'Phase 7A preserves matos.authorized_status_transition to satisfy trigger protection'
);

// REGRESSION A: Phase 4 State Machine Matrix Preservation in Phase 7
const tisMatch = phase7Sql.match(
  /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.transition_incident_status[\s\S]+?\$\$([\s\S]+?)\$\$;/i
);
assert(tisMatch !== null, 'Extracted transition_incident_status body from Phase 7 migration');
const tisBody = tisMatch[1];

assert(
  /WHEN\s+'en_route'\s+THEN[\s\S]*?'on_scene'[\s\S]*?'cancelled'[\s\S]*?'unable_to_complete'/i.test(tisBody),
  'Phase 7 transition_incident_status preserves en_route -> on_scene | cancelled | unable_to_complete'
);

assert(
  /WHEN\s+'on_scene'\s+THEN[\s\S]*?'in_progress'[\s\S]*?'cancelled'[\s\S]*?'unable_to_complete'/i.test(tisBody),
  'Phase 7 transition_incident_status preserves on_scene -> in_progress | cancelled | unable_to_complete'
);

assert(
  /WHEN\s+'in_progress'\s+THEN[\s\S]*?'completed'[\s\S]*?'unable_to_complete'/i.test(tisBody),
  'Phase 7 transition_incident_status preserves in_progress -> completed | unable_to_complete'
);

const inProgressBlock = tisBody.match(/WHEN\s+'in_progress'\s+THEN([\s\S]+?)ELSE/i)?.[1] || '';
assert(
  !inProgressBlock.includes('cancelled'),
  'Phase 7 transition_incident_status strictly FORBIDS in_progress -> cancelled'
);

const auditEvents = [
  'ASSIGNMENT_ACCEPTED',
  'ASSIGNMENT_EN_ROUTE',
  'ASSIGNMENT_ON_SCENE',
  'INCIDENT_WORK_STARTED',
  'ASSIGNMENT_COMPLETED',
];

for (const ev of auditEvents) {
  assert(rpcBody.includes(`'${ev}'`), `worker_transition_assignment records operational event ${ev}`);
}

// ------------------------------------------------------------------------------
// SECTION 6: Execution Privileges & Revocations
// ------------------------------------------------------------------------------
console.log('\n--- 6. Execution Privileges & Revocations ---');

assert(
  phase7Sql.includes('REVOKE ALL ON FUNCTION public.worker_transition_assignment(UUID, TEXT) FROM PUBLIC'),
  'worker_transition_assignment: execution revoked from PUBLIC'
);

assert(
  phase7Sql.includes('REVOKE ALL ON FUNCTION public.worker_transition_assignment(UUID, TEXT) FROM anon'),
  'worker_transition_assignment: execution revoked from anon'
);

assert(
  phase7Sql.includes('GRANT EXECUTE ON FUNCTION public.worker_transition_assignment(UUID, TEXT) TO authenticated'),
  'worker_transition_assignment: execution granted to authenticated'
);

// ------------------------------------------------------------------------------
// SECTION 7: Application Data Layer (assignment-data.ts)
// ------------------------------------------------------------------------------
console.log('\n--- 7. Application Data Layer (assignment-data.ts) ---');

const dataPath = path.join(rootDir, 'src/lib/worker/assignment-data.ts');
assert(fs.existsSync(dataPath), 'src/lib/worker/assignment-data.ts exists');

const dataContent = fs.readFileSync(dataPath, 'utf8');

assert(
  dataContent.includes('export async function getCurrentWorkerAssignment'),
  'assignment-data.ts exports getCurrentWorkerAssignment'
);

assert(
  dataContent.includes('export function validateAndNormalizeWorkerAssignment'),
  'assignment-data.ts exports validateAndNormalizeWorkerAssignment'
);

assert(
  dataContent.includes("user.profile.role !== 'worker'"),
  'assignment-data.ts checks user role is worker'
);

assert(
  dataContent.includes('Date.parse') && dataContent.includes('Number.isFinite'),
  'assignment-data.ts validates assigned_at with finite Date.parse'
);

assert(
  !dataContent.includes("|| ''") && !dataContent.includes("?? ''"),
  'assignment-data.ts does NOT fabricate empty string fallbacks for customer or location'
);

assert(
  !dataContent.includes('new Date().toISOString()'),
  'assignment-data.ts does NOT fabricate timestamps via new Date().toISOString()'
);

assert(
  dataContent.includes('assignments.length > 1'),
  'assignment-data.ts fails closed if multiple active assignments are returned'
);

// REGRESSION B1: Required assignment property presence (including vehicle_id and vehicle)
const reqAssignmentKeys = ['id', 'status', 'assigned_at', 'vehicle_id', 'vehicle', 'incident'];
for (const k of reqAssignmentKeys) {
  assert(
    new RegExp(`requiredAssignmentKeys[\\s\\S]*?'${k}'`).test(dataContent),
    `assignment-data.ts requiredAssignmentKeys includes '${k}'`
  );
}
assert(
  /for\s*\(\s*const\s+\w+\s+of\s+requiredAssignmentKeys\s*\)\s*\{[\s\S]*?hasOwnProperty[\s\S]*?return null/i.test(dataContent),
  'assignment-data.ts fails closed (returns null) if any required assignment property is missing'
);

// REGRESSION B2: Required incident property presence (customer, location, capability)
const reqIncidentKeys = [
  'id',
  'reference_number',
  'status',
  'service_type',
  'priority',
  'customer_name',
  'customer_phone',
  'location_address',
  'required_capability',
];
for (const k of reqIncidentKeys) {
  assert(
    new RegExp(`requiredIncidentKeys[\\s\\S]*?'${k}'`).test(dataContent),
    `assignment-data.ts requiredIncidentKeys includes '${k}'`
  );
}
assert(
  /for\s*\(\s*const\s+\w+\s+of\s+requiredIncidentKeys\s*\)\s*\{[\s\S]*?hasOwnProperty[\s\S]*?return null/i.test(dataContent),
  'assignment-data.ts fails closed (returns null) if any required incident property is missing'
);

// REGRESSION B3: Vehicle relationship integrity
assert(
  /record\.vehicle_id\s*===\s*null[\s\S]*?record\.vehicle\s*!==\s*null[\s\S]*?return null/i.test(dataContent),
  'assignment-data.ts validates vehicle must be null when vehicle_id is null'
);
assert(
  /veh\.id\s*!==\s*record\.vehicle_id[\s\S]*?return null/i.test(dataContent),
  'assignment-data.ts validates joined vehicle.id matches vehicle_id when non-null'
);

// REGRESSION B4: Nonexistent field location_description must NOT exist; location_address MUST exist
assert(
  !dataContent.includes('location_description'),
  'assignment-data.ts does NOT query, validate, or return nonexistent location_description'
);
assert(
  dataContent.includes('location_address'),
  'assignment-data.ts queries, validates, and returns genuine location_address'
);

// ------------------------------------------------------------------------------
// SECTION 7B: Lifecycle Pair Consistency Validation (assignment-data.ts)
// ------------------------------------------------------------------------------
console.log('\n--- 7B. Lifecycle Pair Consistency Validation (assignment-data.ts) ---');

assert(
  dataContent.includes('VALID_ACTIVE_LIFECYCLE_PAIRS'),
  'assignment-data.ts defines VALID_ACTIVE_LIFECYCLE_PAIRS'
);

const pairsMatch = dataContent.match(
  /const\s+VALID_ACTIVE_LIFECYCLE_PAIRS\s*=\s*new\s+Set\s*(?:<[^>]+>)?\s*\(\s*\[([\s\S]+?)\]\s*\)/
);
assert(pairsMatch !== null, 'Extracted VALID_ACTIVE_LIFECYCLE_PAIRS Set definition from assignment-data.ts');
const pairsSetBody = pairsMatch[1];

const extractedPairs = [...pairsSetBody.matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] || m[2]);

assert(
  extractedPairs.length === 5,
  `VALID_ACTIVE_LIFECYCLE_PAIRS contains exactly 5 entries (found: ${extractedPairs.length})`
);

const expectedExactFivePairs = [
  'assigned|dispatched',
  'accepted|dispatched',
  'en_route|en_route',
  'on_scene|on_scene',
  'on_scene|in_progress',
];

for (const pair of expectedExactFivePairs) {
  assert(
    extractedPairs.includes(pair),
    `VALID_ACTIVE_LIFECYCLE_PAIRS includes authoritative pair '${pair}'`
  );
}

// Ensure representative invalid pairs are strictly excluded from the whitelist
const representativeInvalidPairs = [
  'assigned|completed',
  'accepted|en_route',
  'en_route|dispatched',
  'on_scene|completed',
  'on_scene|cancelled',
  'on_scene|unable_to_complete',
];

for (const invalidPair of representativeInvalidPairs) {
  assert(
    !extractedPairs.includes(invalidPair),
    `VALID_ACTIVE_LIFECYCLE_PAIRS strictly excludes invalid pair '${invalidPair}'`
  );
}

// Verify runtime enforcement: checks pair membership and returns null on invalid pairs
assert(
  /VALID_ACTIVE_LIFECYCLE_PAIRS\.has\(\s*\w+\s*\)[\s\S]*?return\s+null/i.test(dataContent) ||
  /!VALID_ACTIVE_LIFECYCLE_PAIRS\.has\([\s\S]+?\)[\s\S]*?return\s+null/i.test(dataContent),
  'assignment-data.ts enforces VALID_ACTIVE_LIFECYCLE_PAIRS.has(...) and returns null when pair is missing'
);

// ------------------------------------------------------------------------------
// SECTION 8: Server Action (actions.ts)
// ------------------------------------------------------------------------------
console.log('\n--- 8. Server Action (actions.ts) ---');

const actionPath = path.join(rootDir, 'src/lib/worker/actions.ts');
assert(fs.existsSync(actionPath), 'src/lib/worker/actions.ts exists');

const actionContent = fs.readFileSync(actionPath, 'utf8');

assert(
  actionContent.startsWith("'use server'") || actionContent.includes('"use server"'),
  'src/lib/worker/actions.ts is declared as a Server Action module'
);

// REGRESSION C: Server Action export safety — transitionWorkerAssignment is the ONLY exported runtime function
const runtimeExportMatches = [...actionContent.matchAll(/export\s+(?:async\s+)?function\s+([a-zA-Z0-9_]+)/g)].map(
  (m) => m[1]
);
assert(
  runtimeExportMatches.length === 1 && runtimeExportMatches[0] === 'transitionWorkerAssignment',
  "actions.ts exports ONLY the async server action 'transitionWorkerAssignment'"
);

const prohibitedExports = [
  'AUTHORITATIVE_ASSIGNMENT_STATUSES',
  'AUTHORITATIVE_INCIDENT_STATUSES',
  'AUTHORITATIVE_WORKER_AVAILABILITY_STATUSES',
  'validateWorkerSuccessPayload',
  'mapWorkerRpcError',
  'UUID_REGEX',
];
for (const sym of prohibitedExports) {
  assert(
    !new RegExp(`export\\s+(?:const|function|let|var)\\s+${sym}\\b`).test(actionContent),
    `actions.ts does NOT export '${sym}' (remains module-private)`
  );
}

assert(
  actionContent.includes("rpc('worker_transition_assignment'"),
  'actions.ts invokes worker_transition_assignment RPC'
);

const errorCodes = [
  'UNAUTHORIZED',
  'FORBIDDEN',
  'ASSIGNMENT_NOT_FOUND',
  'INVALID_TRANSITION',
  'ASSIGNMENT_CONFLICT',
  'INVALID_RESPONSE',
  'WORKER_ACTION_UNAVAILABLE',
];

for (const code of errorCodes) {
  assert(actionContent.includes(`'${code}'`), `actions.ts maps to domain error code ${code}`);
}

assert(
  !actionContent.includes('return { error: err }') &&
  !actionContent.includes('return { error: error.message }'),
  'actions.ts does NOT leak raw Postgres/Supabase error messages to caller'
);

// Authoritative Status Enum Arrays (private to actions.ts)
assert(
  actionContent.includes('AUTHORITATIVE_ASSIGNMENT_STATUSES'),
  'actions.ts defines AUTHORITATIVE_ASSIGNMENT_STATUSES'
);
const authoritativeAssignmentStatuses = [
  'assigned',
  'accepted',
  'en_route',
  'on_scene',
  'completed',
  'cancelled',
];
for (const st of authoritativeAssignmentStatuses) {
  assert(
    actionContent.includes(`'${st}'`),
    `AUTHORITATIVE_ASSIGNMENT_STATUSES includes '${st}'`
  );
}
assert(
  /AUTHORITATIVE_ASSIGNMENT_STATUSES\.includes\(\s*rec\.assignment_status/i.test(actionContent),
  'actions.ts performs runtime membership validation on assignment_status'
);

assert(
  actionContent.includes('AUTHORITATIVE_INCIDENT_STATUSES'),
  'actions.ts defines AUTHORITATIVE_INCIDENT_STATUSES'
);
const authoritativeIncidentStatuses = [
  'new',
  'triaged',
  'ready_for_dispatch',
  'dispatched',
  'en_route',
  'on_scene',
  'in_progress',
  'completed',
  'cancelled',
  'unable_to_complete',
];
for (const ist of authoritativeIncidentStatuses) {
  assert(
    actionContent.includes(`'${ist}'`),
    `AUTHORITATIVE_INCIDENT_STATUSES includes '${ist}'`
  );
}
assert(
  /AUTHORITATIVE_INCIDENT_STATUSES\.includes\(\s*rec\.incident_status/i.test(actionContent),
  'actions.ts performs runtime membership validation on incident_status'
);

assert(
  actionContent.includes('AUTHORITATIVE_WORKER_AVAILABILITY_STATUSES'),
  'actions.ts defines AUTHORITATIVE_WORKER_AVAILABILITY_STATUSES'
);
const authoritativeWorkerAvailabilityStatuses = [
  'off_duty',
  'available',
  'busy',
  'unavailable',
];
for (const wst of authoritativeWorkerAvailabilityStatuses) {
  assert(
    actionContent.includes(`'${wst}'`),
    `AUTHORITATIVE_WORKER_AVAILABILITY_STATUSES includes '${wst}'`
  );
}
assert(
  /AUTHORITATIVE_WORKER_AVAILABILITY_STATUSES\.includes\(\s*rec\.worker_availability/i.test(actionContent),
  'actions.ts performs runtime membership validation on worker_availability'
);

// Reject direct unchecked casting
assert(
  !/assignment_status:\s*rec\.assignment_status\s+as\s+AssignmentStatus/i.test(actionContent),
  'actions.ts does NOT directly cast raw unvalidated assignment_status in return payload'
);
assert(
  !/incident_status:\s*rec\.incident_status\s+as\s+IncidentStatus/i.test(actionContent),
  'actions.ts does NOT directly cast raw unvalidated incident_status in return payload'
);
assert(
  !/worker_availability:\s*rec\.worker_availability\s+as\s+WorkerAvailabilityStatus/i.test(actionContent),
  'actions.ts does NOT directly cast raw unvalidated worker_availability in return payload'
);

// REGRESSION D: Action-specific exact invariants
assert(
  /case\s+'ACCEPT_ASSIGNMENT':[\s\S]*?assignment_status\s*!==\s*'accepted'[\s\S]*?incident_status\s*!==\s*'dispatched'[\s\S]*?worker_availability\s*!==\s*'busy'[\s\S]*?rec\.completed_at\s*!==\s*null/i.test(
    actionContent
  ),
  'ACCEPT_ASSIGNMENT invariant: assignment=accepted, incident=dispatched, worker=busy, completed_at=null'
);

assert(
  /case\s+'START_JOURNEY':[\s\S]*?assignment_status\s*!==\s*'en_route'[\s\S]*?incident_status\s*!==\s*'en_route'[\s\S]*?rec\.completed_at\s*!==\s*null/i.test(
    actionContent
  ),
  'START_JOURNEY invariant: assignment=en_route, incident=en_route, completed_at=null'
);

assert(
  /case\s+'ARRIVE_ON_SCENE':[\s\S]*?assignment_status\s*!==\s*'on_scene'[\s\S]*?incident_status\s*!==\s*'on_scene'[\s\S]*?rec\.completed_at\s*!==\s*null/i.test(
    actionContent
  ),
  'ARRIVE_ON_SCENE invariant: assignment=on_scene, incident=on_scene, completed_at=null'
);

assert(
  /case\s+'START_WORK':[\s\S]*?assignment_status\s*!==\s*'on_scene'[\s\S]*?incident_status\s*!==\s*'in_progress'[\s\S]*?rec\.completed_at\s*!==\s*null/i.test(
    actionContent
  ),
  'START_WORK invariant: assignment=on_scene, incident=in_progress, completed_at=null'
);

assert(
  /case\s+'COMPLETE_JOB':[\s\S]*?assignment_status\s*!==\s*'completed'[\s\S]*?incident_status\s*!==\s*'completed'[\s\S]*?worker_availability\s*!==\s*'available'[\s\S]*?rec\.completed_at\s*===\s*null/i.test(
    actionContent
  ),
  'COMPLETE_JOB invariant: assignment=completed, incident=completed, worker=available, completed_at!=null'
);

assert(
  /case\s+'COMPLETE_JOB':[\s\S]*?Date\.parse\(rec\.completed_at\)[\s\S]*?Number\.isFinite/i.test(actionContent),
  'COMPLETE_JOB validates completed_at with finite Date.parse'
);

// ------------------------------------------------------------------------------
// SECTION 9: Authoritative TypeScript Types
// ------------------------------------------------------------------------------
console.log('\n--- 9. Authoritative TypeScript Types ---');

const typesPath = path.join(rootDir, 'src/types/index.ts');
const typesContent = fs.readFileSync(typesPath, 'utf8');

assert(typesContent.includes('WorkerLifecycleAction'), 'types/index.ts defines WorkerLifecycleAction');
assert(typesContent.includes('WorkerTransitionErrorCode'), 'types/index.ts defines WorkerTransitionErrorCode');
assert(typesContent.includes('WorkerTransitionSuccessPayload'), 'types/index.ts defines WorkerTransitionSuccessPayload');
assert(typesContent.includes('WorkerTransitionResult'), 'types/index.ts defines WorkerTransitionResult');
assert(typesContent.includes('WorkerActiveAssignment'), 'types/index.ts defines WorkerActiveAssignment');
assert(typesContent.includes('ALLOWED_WORKER_ACTIONS'), 'types/index.ts defines ALLOWED_WORKER_ACTIONS');

assert(
  !typesContent.includes('location_description'),
  'types/index.ts WorkerActiveAssignment does NOT contain location_description'
);
assert(
  typesContent.includes('location_address: string | null'),
  'types/index.ts WorkerActiveAssignment retains genuine location_address field'
);

// ------------------------------------------------------------------------------
// SECTION 10: Strict Phase Boundaries (No GPS / Realtime / PWA / Twilio / Vapi)
// ------------------------------------------------------------------------------
console.log('\n--- 10. Phase Boundary Enforcement ---');

const phase7Files = [
  phase7SqlPath,
  dataPath,
  actionPath,
];

for (const fp of phase7Files) {
  const content = fs.readFileSync(fp, 'utf8');
  const base = path.basename(fp);

  assert(!content.includes('watchPosition'), `${base} does not contain watchPosition`);
  assert(!content.includes('navigator.geolocation'), `${base} does not contain navigator.geolocation`);
  assert(!content.includes('getCurrentPosition'), `${base} does not contain getCurrentPosition`);
  assert(!content.includes('postgres_changes'), `${base} does not contain Realtime postgres_changes`);
  assert(!content.includes('serviceWorker'), `${base} does not contain serviceWorker`);
  assert(!content.includes('Twilio') && !content.includes('twilio'), `${base} does not contain Twilio`);
  assert(!content.includes('Vapi') && !content.includes('vapi'), `${base} does not contain Vapi`);
}

// ------------------------------------------------------------------------------
// SUMMARY
// ------------------------------------------------------------------------------
console.log('\n================================================================');
console.log(`  PHASE 7A VERIFICATION RESULTS: ${passedChecks} / ${totalChecks} PASSED, 0 FAILED`);
console.log('================================================================\n');
console.log('SUCCESS: All Phase 7A worker lifecycle database and application checks passed cleanly.');
