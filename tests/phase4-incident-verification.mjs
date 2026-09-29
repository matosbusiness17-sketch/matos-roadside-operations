/**
 * ==============================================================================
 * MATOS SYSTEMS — PHASE 4 INCIDENT MANAGEMENT & STATE MACHINE VERIFICATION SUITE
 * ==============================================================================
 * Static architectural, security, and schema verification for Phase 4:
 * 1. Migration integrity & isolation (Phase 2 & 3 untouched, Phase 4 migration exists)
 * 2. Status model migration ('created' -> 'new', 10-state CHECK constraint)
 * 3. Authoritative state transition function (transition_incident_status):
 *    - Role enforcement (admin & operator only; worker blocked)
 *    - Session-derived organization and actor identity
 *    - Concurrency protection via row locking (FOR UPDATE)
 *    - Locked state machine matrix enforcement
 *    - Terminal state progression blocked
 *    - Same-state transitions rejected
 *    - Atomic status update + operational_events audit append
 * 4. Direct status update bypass prevention (trg_protect_incident_status trigger)
 * 5. Incident creation function (create_incident) & reference number generator:
 *    - Exact 16-parameter function identity
 *    - RETURNS JSONB (not UUID) with success, incident_id, reference_number, status, event_id, created_at
 *    - Captures operational event id via RETURNING id INTO v_event_id
 *    - Exact locked Phase 2 TEXT service_type set (no winching, no other)
 *    - Exact locked Phase 2 TEXT priority set
 *    - No nonexistent enum casts (::public.service_type, ::public.incident_priority)
 *    - Direct TEXT insert contract into public.incidents
 *    - Session-derived tenant & creator
 *    - PostGIS geography point construction order (longitude, latitude)
 *    - Finite coordinate, accuracy, and vehicle year validation
 *    - Operator manual provenance enforcement
 * 6. Append-only operational audit trail reuse (operational_events table)
 * 7. Real UI implementation (/incidents, /incidents/new, /incidents/[id]):
 *    - Real database queries, no hardcoded demo rows
 *    - Active capabilities catalogue loaded from database
 *    - Operational event timeline rendered
 *    - Valid next-action controls derived from state matrix
 * 8. Strict Phase boundaries (No Phase 5-10 premature implementations)
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
console.log('  MATOS SYSTEMS — PHASE 4 INCIDENT MANAGEMENT & STATE MACHINE   ');
console.log('================================================================');

// ------------------------------------------------------------------------------
// SECTION 0: Migration Isolation (Phase 2 and Phase 3 Untouched)
// ------------------------------------------------------------------------------
console.log('\n--- 0. Historical Migration Isolation ---');

const phase2MigrationPath = path.join(
  rootDir,
  'supabase/migrations/20260928190000_phase2_core_schema_and_rls.sql'
);
const phase3MigrationPath = path.join(
  rootDir,
  'supabase/migrations/20260929120000_phase3_spatial_and_capabilities.sql'
);

assert(fs.existsSync(phase2MigrationPath), 'Phase 2 migration file exists', phase2MigrationPath);
assert(fs.existsSync(phase3MigrationPath), 'Phase 3 migration file exists', phase3MigrationPath);

// ------------------------------------------------------------------------------
// SECTION 1: Migration Existence & Ordering
// ------------------------------------------------------------------------------
console.log('\n--- 1. Migration Existence & Execution Order ---');

const phase4MigrationPath = path.join(
  rootDir,
  'supabase/migrations/20260929140000_phase4_incident_state_machine.sql'
);
assert(fs.existsSync(phase4MigrationPath), 'Phase 4 migration file exists', phase4MigrationPath);

const phase4Sql = fs.readFileSync(phase4MigrationPath, 'utf8');

// Strict order check:
// A. DROP CONSTRAINT IF EXISTS incidents_status_check
// B. UPDATE public.incidents SET status = 'new' WHERE status = 'created'
// C. ALTER COLUMN status SET DEFAULT 'new'
// D. ADD CONSTRAINT incidents_status_check CHECK (...)

const idxDrop = phase4Sql.indexOf('DROP CONSTRAINT IF EXISTS incidents_status_check');
const idxUpdate = phase4Sql.search(/UPDATE\s+public\.incidents\s+SET\s+status\s*=\s*'new'\s+WHERE\s+status\s*=\s*'created'/i);
const idxDefault = phase4Sql.search(/ALTER\s+COLUMN\s+status\s+SET\s+DEFAULT\s+'new'/i);
const idxAddConstraint = phase4Sql.search(/ADD\s+CONSTRAINT\s+incidents_status_check\s+CHECK/i);

assert(idxDrop !== -1, 'Migration contains DROP CONSTRAINT IF EXISTS incidents_status_check');
assert(idxUpdate !== -1, 'Migration contains status update from "created" to "new"');
assert(idxDefault !== -1, 'Migration sets status default to "new"');
assert(idxAddConstraint !== -1, 'Migration adds new incidents_status_check constraint');

assert(
  idxDrop < idxUpdate && idxUpdate < idxDefault && idxDefault < idxAddConstraint,
  'Old status CHECK is removed before created -> new data migration (DROP < UPDATE < DEFAULT < ADD)',
  `Indices: drop=${idxDrop}, update=${idxUpdate}, default=${idxDefault}, add=${idxAddConstraint}`
);

// ------------------------------------------------------------------------------
// SECTION 2: Exact 10-State Constraint Extraction & Validation
// ------------------------------------------------------------------------------
console.log('\n--- 2. Exact 10-State Constraint Extraction ---');

const expectedStatuses = [
  'cancelled',
  'completed',
  'dispatched',
  'en_route',
  'in_progress',
  'new',
  'on_scene',
  'ready_for_dispatch',
  'triaged',
  'unable_to_complete',
];

// Extract CHECK (status IN (...)) definition
const checkMatch = phase4Sql.match(
  /ADD\s+CONSTRAINT\s+incidents_status_check\s+CHECK\s*\(\s*status\s+IN\s*\(([^)]+)\)\s*\)/i
);
assert(checkMatch !== null, 'Successfully matched ADD CONSTRAINT incidents_status_check CHECK expression');

if (checkMatch) {
  const extractedStatuses = [...checkMatch[1].matchAll(/'([a-z_]+)'/g)]
    .map((m) => m[1])
    .sort();

  assert(
    extractedStatuses.length === 10,
    `Constraint contains exactly 10 statuses (found: ${extractedStatuses.length})`,
    JSON.stringify(extractedStatuses)
  );

  assert(
    !extractedStatuses.includes('created'),
    'Deprecated status "created" is completely absent from constraint'
  );

  const exactMatch =
    extractedStatuses.length === expectedStatuses.length &&
    extractedStatuses.every((st, idx) => st === expectedStatuses[idx]);

  assert(
    exactMatch,
    'Constraint statuses match the exact locked 10-state lifecycle set',
    `Expected: ${JSON.stringify(expectedStatuses)}\nFound: ${JSON.stringify(extractedStatuses)}`
  );
}

// ------------------------------------------------------------------------------
// SECTION 3: Concurrency-Safe Reference Number Generator
// ------------------------------------------------------------------------------
console.log('\n--- 3. Concurrency-Safe Reference Generator & Privilege Model ---');

assert(
  phase4Sql.includes('CREATE OR REPLACE FUNCTION public.generate_incident_reference_number'),
  'generate_incident_reference_number function exists in migration'
);

const genRefMatch = phase4Sql.match(
  /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.generate_incident_reference_number[\s\S]+?\$\$[\s\S]+?\$\$;/i
);

assert(genRefMatch !== null, 'generate_incident_reference_number body extracted');

if (genRefMatch) {
  const genRefFn = genRefMatch[0];

  assert(genRefFn.includes('SECURITY DEFINER'), 'Reference generator is SECURITY DEFINER');
  assert(genRefFn.includes('SET search_path = public'), 'Reference generator sets safe search_path = public');
  assert(genRefFn.includes('p_org_id IS NULL'), 'Reference generator validates non-null organization ID');
  assert(
    genRefFn.includes('pg_advisory_xact_lock'),
    'Reference generator uses pg_advisory_xact_lock for transaction-scoped serialization'
  );
  assert(
    genRefFn.includes('hashtext(p_org_id::text)'),
    'Reference generator keys advisory lock by organization hash'
  );
  assert(
    genRefFn.includes('MAX(') && genRefFn.includes('regexp_replace('),
    'Reference generator determines next sequence number from highest numeric suffix'
  );
  assert(
    genRefFn.includes('v_next_seq < 10000'),
    'Reference generator formats without truncating sequence values >= 10000'
  );
}

// Generator privileges
assert(
  phase4Sql.includes('REVOKE ALL ON FUNCTION public.generate_incident_reference_number(UUID) FROM PUBLIC'),
  'PUBLIC access revoked from generate_incident_reference_number'
);
assert(
  phase4Sql.includes('REVOKE ALL ON FUNCTION public.generate_incident_reference_number(UUID) FROM authenticated'),
  'generate_incident_reference_number is explicitly revoked from authenticated role'
);
assert(
  phase4Sql.includes('REVOKE ALL ON FUNCTION public.generate_incident_reference_number(UUID) FROM anon'),
  'generate_incident_reference_number is explicitly revoked from anon role'
);
assert(
  !/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.generate_incident_reference_number\s*\([^)]*\)\s*TO\s+authenticated/i.test(phase4Sql),
  'generate_incident_reference_number is NOT granted to authenticated'
);
assert(
  !/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.generate_incident_reference_number\s*\([^)]*\)\s*TO\s+anon/i.test(phase4Sql),
  'generate_incident_reference_number is NOT granted to anon'
);

// ------------------------------------------------------------------------------
// SECTION 4: Direct Mutation Policy Closures (RLS Hardening)
// ------------------------------------------------------------------------------
console.log('\n--- 4. Direct Mutation Policy Closures (RLS Hardening) ---');

assert(
  phase4Sql.includes('DROP POLICY IF EXISTS "incidents_insert_operator_admin" ON public.incidents'),
  'Phase 4 drops direct incident INSERT policy (incidents_insert_operator_admin)'
);
assert(
  !/CREATE\s+POLICY\s+"[^"]+"\s+ON\s+public\.incidents\s+FOR\s+INSERT/i.test(phase4Sql),
  'Phase 4 does not create a replacement generic direct incident INSERT policy'
);

assert(
  phase4Sql.includes('DROP POLICY IF EXISTS "incidents_update" ON public.incidents'),
  'Phase 4 drops Phase 2 direct incident UPDATE policy (incidents_update)'
);
assert(
  phase4Sql.includes('DROP POLICY IF EXISTS "incidents_update_operator_admin" ON public.incidents'),
  'Phase 4 drops direct incident UPDATE policy (incidents_update_operator_admin)'
);
assert(
  !/CREATE\s+POLICY\s+"[^"]+"\s+ON\s+public\.incidents\s+FOR\s+UPDATE/i.test(phase4Sql),
  'Phase 4 does not create a replacement generic direct incident UPDATE policy'
);

assert(
  phase4Sql.includes('DROP POLICY IF EXISTS "events_insert" ON public.operational_events'),
  'Phase 4 drops direct operational_events INSERT policy (events_insert)'
);
assert(
  !/CREATE\s+POLICY\s+"[^"]+"\s+ON\s+public\.operational_events\s+FOR\s+INSERT/i.test(phase4Sql),
  'Phase 4 does not create a replacement generic direct operational_events INSERT policy'
);

// ------------------------------------------------------------------------------
// SECTION 5: Authoritative State Transition Function & Exact Target Sets
// ------------------------------------------------------------------------------
console.log('\n--- 5. Authoritative State Transition Function & Matrix ---');

assert(
  phase4Sql.includes('CREATE OR REPLACE FUNCTION public.transition_incident_status'),
  'transition_incident_status function is defined in Phase 4 migration'
);

const transitionFnMatch = phase4Sql.match(
  /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.transition_incident_status[\s\S]+?\$\$[\s\S]+?\$\$;/i
);

assert(transitionFnMatch !== null, 'transition_incident_status body extracted successfully');

if (transitionFnMatch) {
  const transitionFn = transitionFnMatch[0];

  assert(transitionFn.includes('SECURITY DEFINER'), 'transition_incident_status is SECURITY DEFINER');
  assert(transitionFn.includes('SET search_path = public, extensions'), 'transition_incident_status specifies safe search_path');
  assert(transitionFn.includes('p_incident_id IS NULL'), 'transition_incident_status validates non-null incident ID');
  assert(transitionFn.includes('p_new_status IS NULL'), 'transition_incident_status validates non-null target status');

  assert(
    transitionFn.includes('public.get_current_user_organization_id()'),
    'transition_incident_status derives organization from session'
  );
  assert(
    transitionFn.includes('public.get_current_user_role()'),
    'transition_incident_status derives role from session'
  );
  assert(
    transitionFn.includes('auth.uid()'),
    'transition_incident_status derives actor ID from auth.uid()'
  );
  assert(
    /v_caller_role\s+NOT\s+IN\s*\(\s*'admin'\s*,\s*'operator'\s*\)/i.test(transitionFn),
    'transition_incident_status checks caller role via NOT IN (\'admin\', \'operator\')'
  );

  assert(
    transitionFn.includes('organization_id = v_caller_org') && transitionFn.includes('FOR UPDATE'),
    'transition_incident_status retrieves incident strictly within tenant with FOR UPDATE row lock'
  );

  assert(
    transitionFn.includes('v_current_status = p_new_status'),
    'transition_incident_status explicitly rejects same-state transitions'
  );

  // Exact Terminal states check
  const terminalMatch = transitionFn.match(/v_current_status\s+IN\s*\(([^)]+)\)\s+THEN\s+RAISE\s+EXCEPTION\s+'Cannot transition incident in terminal status/i);
  assert(terminalMatch !== null, 'Found terminal state rejection clause in transition_incident_status');
  if (terminalMatch) {
    const extractedTerminal = [...terminalMatch[1].matchAll(/'([a-z_]+)'/g)]
      .map((m) => m[1])
      .sort();
    const expectedTerminal = ['cancelled', 'completed', 'unable_to_complete'];
    const terminalExact =
      extractedTerminal.length === expectedTerminal.length &&
      extractedTerminal.every((st, idx) => st === expectedTerminal[idx]);
    assert(
      terminalExact,
      'Terminal state rejection set matches exactly: cancelled, completed, unable_to_complete',
      `Found: ${JSON.stringify(extractedTerminal)}`
    );
  }

  // Exact Transition Matrix Check
  const expectedMatrix = {
    new: ['cancelled', 'triaged'],
    triaged: ['cancelled', 'ready_for_dispatch'],
    ready_for_dispatch: ['cancelled', 'dispatched'],
    dispatched: ['cancelled', 'en_route'],
    en_route: ['cancelled', 'on_scene', 'unable_to_complete'],
    on_scene: ['cancelled', 'in_progress', 'unable_to_complete'],
    in_progress: ['completed', 'unable_to_complete'],
  };

  for (const [sourceState, expectedTargets] of Object.entries(expectedMatrix)) {
    const blockRegex = new RegExp(
      `WHEN\\s+'${sourceState}'\\s+THEN[\\s\\S]*?IF\\s+p_new_status\\s+IN\\s*\\(([^)]+)\\)[\\s\\S]*?THEN[\\s\\S]*?v_valid_transition\\s*:=\\s*true;`,
      'i'
    );
    const blockMatch = transitionFn.match(blockRegex);
    assert(blockMatch !== null, `Extracted transition target block for source state "${sourceState}"`);

    if (blockMatch) {
      const extractedTargets = [...blockMatch[1].matchAll(/'([a-z_]+)'/g)]
        .map((m) => m[1])
        .sort();

      const sortedExpected = [...expectedTargets].sort();
      const isExact =
        extractedTargets.length === sortedExpected.length &&
        extractedTargets.every((t, i) => t === sortedExpected[i]);

      assert(
        isExact,
        `State "${sourceState}" transitions strictly and exactly to ${JSON.stringify(sortedExpected)}`,
        `Extracted: ${JSON.stringify(extractedTargets)}`
      );
    }
  }

  assert(
    transitionFn.includes("set_config('matos.authorized_status_transition', 'true', true)") &&
    transitionFn.includes("set_config('matos.authorized_status_transition', 'false', true)"),
    'transition_incident_status sets and resets matos.authorized_status_transition flag around update'
  );

  assert(
    transitionFn.includes('INSERT INTO public.operational_events') &&
    transitionFn.includes("'INCIDENT_STATUS_CHANGED'"),
    'transition_incident_status records INCIDENT_STATUS_CHANGED event in operational_events'
  );

  assert(
    transitionFn.includes("'previous_status', v_current_status") &&
    transitionFn.includes("'new_status', p_new_status") &&
    transitionFn.includes("'reason', nullif(trim(p_reason), '')"),
    'transition_incident_status captures previous_status, new_status, and trimmed reason in metadata'
  );
}

// ------------------------------------------------------------------------------
// SECTION 6: Controlled Incident Intake Function (create_incident)
// ------------------------------------------------------------------------------
console.log('\n--- 6. Controlled Incident Intake Function & Parameter Identity ---');

assert(
  phase4Sql.includes('CREATE OR REPLACE FUNCTION public.create_incident'),
  'create_incident function exists in Phase 4 migration'
);

const createFnMatch = phase4Sql.match(
  /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.create_incident[\s\S]+?\$\$[\s\S]+?\$\$;/i
);

assert(createFnMatch !== null, 'create_incident body extracted');

if (createFnMatch) {
  const createIncidentFn = createFnMatch[0];

  // A. Return type verification: RETURNS JSONB and NOT RETURNS UUID
  assert(
    /RETURNS\s+JSONB/i.test(createIncidentFn),
    'create_incident return type is explicitly RETURNS JSONB'
  );
  assert(
    !/RETURNS\s+UUID/i.test(createIncidentFn),
    'create_incident return type is NOT RETURNS UUID'
  );

  // B. JSON result contract & Event ID capture
  assert(
    createIncidentFn.includes('jsonb_build_object('),
    'create_incident returns jsonb_build_object payload'
  );
  assert(
    createIncidentFn.includes("'success', true"),
    'create_incident returns success: true in jsonb payload'
  );
  assert(
    createIncidentFn.includes("'incident_id'"),
    'create_incident returns incident_id in jsonb payload'
  );
  assert(
    createIncidentFn.includes("'reference_number'"),
    'create_incident returns reference_number in jsonb payload'
  );
  assert(
    createIncidentFn.includes("'status', 'new'") ||
    (createIncidentFn.includes("'status'") && createIncidentFn.includes("'new'")),
    'create_incident returns status: "new" in jsonb payload'
  );
  assert(
    createIncidentFn.includes("'event_id'"),
    'create_incident returns event_id in jsonb payload'
  );
  assert(
    createIncidentFn.includes("'created_at'"),
    'create_incident returns created_at in jsonb payload'
  );

  assert(
    /INSERT\s+INTO\s+public\.operational_events[\s\S]+?RETURNING\s+id\s+INTO\s+v_event_id/i.test(createIncidentFn),
    'create_incident captures operational event id using RETURNING id INTO v_event_id'
  );
  assert(
    !/RETURN\s+v_incident_id\s*;/i.test(createIncidentFn),
    'create_incident does NOT merely return scalar v_incident_id'
  );

  // C. Exact Service Type Set Validation
  const serviceBlockMatch = createIncidentFn.match(
    /v_service_type\s+NOT\s+IN\s*\(([^)]+)\)/i
  );
  assert(serviceBlockMatch !== null, 'create_incident contains service_type validation block');

  if (serviceBlockMatch) {
    const extractedServiceTypes = [...serviceBlockMatch[1].matchAll(/'([a-z_]+)'/g)]
      .map((m) => m[1])
      .sort();

    const expectedServiceTypes = [
      'fuel_delivery',
      'general_assistance',
      'jump_start',
      'lockout',
      'tire_change',
      'towing',
      'winch_recovery',
    ];

    const serviceExact =
      extractedServiceTypes.length === expectedServiceTypes.length &&
      extractedServiceTypes.every((val, i) => val === expectedServiceTypes[i]);

    assert(
      serviceExact,
      'create_incident service_type validation accepts exactly the 7 locked Phase 2 types',
      `Found: ${JSON.stringify(extractedServiceTypes)}`
    );

    assert(
      !extractedServiceTypes.includes('winching'),
      'create_incident strictly rejects invalid "winching"'
    );
    assert(
      !extractedServiceTypes.includes('other'),
      'create_incident strictly rejects invalid "other"'
    );
  }

  // D. Exact Priority Set Validation
  const priorityBlockMatch = createIncidentFn.match(
    /v_priority\s+NOT\s+IN\s*\(([^)]+)\)/i
  );
  assert(priorityBlockMatch !== null, 'create_incident contains priority validation block');

  if (priorityBlockMatch) {
    const extractedPriorities = [...priorityBlockMatch[1].matchAll(/'([a-z_]+)'/g)]
      .map((m) => m[1])
      .sort();

    const expectedPriorities = ['critical', 'high', 'low', 'standard'];

    const priorityExact =
      extractedPriorities.length === expectedPriorities.length &&
      extractedPriorities.every((val, i) => val === expectedPriorities[i]);

    assert(
      priorityExact,
      'create_incident priority validation accepts exactly the 4 locked Phase 2 priorities',
      `Found: ${JSON.stringify(extractedPriorities)}`
    );
  }

  // E. Verify No Nonexistent Enum Casts
  assert(
    !createIncidentFn.includes('::public.service_type') &&
    !createIncidentFn.includes('public.service_type'),
    'create_incident contains NO casts or references to nonexistent public.service_type enum'
  );
  assert(
    !createIncidentFn.includes('::public.incident_priority') &&
    !createIncidentFn.includes('public.incident_priority'),
    'create_incident contains NO casts or references to nonexistent public.incident_priority enum'
  );

  // F. Verify Direct TEXT Insert Contract
  assert(
    createIncidentFn.includes('v_service_type TEXT;') &&
    createIncidentFn.includes('v_priority TEXT;'),
    'create_incident declares v_service_type and v_priority as TEXT variables'
  );
  assert(
    /INSERT\s+INTO\s+public\.incidents[\s\S]+?priority[\s\S]+?service_type[\s\S]+?VALUES[\s\S]+?v_priority[\s\S]+?v_service_type/i.test(createIncidentFn),
    'create_incident inserts validated TEXT values v_priority and v_service_type directly into incidents table'
  );

  // G. Security, Session Derivation, and Bounds Validations
  assert(createIncidentFn.includes('SECURITY DEFINER'), 'create_incident is SECURITY DEFINER');
  assert(createIncidentFn.includes('SET search_path = public, extensions'), 'create_incident sets safe search_path');
  assert(createIncidentFn.includes('public.get_current_user_organization_id()'), 'create_incident derives organization from session');
  assert(createIncidentFn.includes('public.get_current_user_role()'), 'create_incident derives caller role from session');
  assert(createIncidentFn.includes('auth.uid()'), 'create_incident derives creator from session auth.uid()');
  assert(
    /v_caller_role\s+NOT\s+IN\s*\(\s*'admin'\s*,\s*'operator'\s*\)/i.test(createIncidentFn),
    'create_incident restricts caller role via NOT IN (\'admin\', \'operator\')'
  );

  // Coordinate validations
  assert(
    createIncidentFn.includes('Latitude and longitude must both be provided or both be null'),
    'create_incident forbids half-coordinate pairs'
  );
  assert(
    createIncidentFn.includes("p_latitude = 'NaN'::DOUBLE PRECISION") &&
    createIncidentFn.includes("p_latitude = 'Infinity'::DOUBLE PRECISION") &&
    createIncidentFn.includes("p_latitude = '-Infinity'::DOUBLE PRECISION"),
    'create_incident explicitly rejects NaN, Infinity, -Infinity for latitude'
  );
  assert(
    createIncidentFn.includes('p_latitude < -90.0 OR p_latitude > 90.0'),
    'create_incident validates latitude bounds (-90 to 90)'
  );
  assert(
    createIncidentFn.includes("p_longitude = 'NaN'::DOUBLE PRECISION") &&
    createIncidentFn.includes("p_longitude = 'Infinity'::DOUBLE PRECISION") &&
    createIncidentFn.includes("p_longitude = '-Infinity'::DOUBLE PRECISION"),
    'create_incident explicitly rejects NaN, Infinity, -Infinity for longitude'
  );
  assert(
    createIncidentFn.includes('p_longitude < -180.0 OR p_longitude > 180.0'),
    'create_incident validates longitude bounds (-180 to 180)'
  );
  assert(
    createIncidentFn.includes('ST_MakePoint(p_longitude, p_latitude)'),
    'create_incident constructs PostGIS point in correct (longitude, latitude) order'
  );

  // Accuracy validation
  assert(
    createIncidentFn.includes('Location accuracy cannot be specified without coordinates'),
    'create_incident rejects location_accuracy when coordinates are absent'
  );
  assert(
    createIncidentFn.includes("p_location_accuracy = 'NaN'::DOUBLE PRECISION") &&
    createIncidentFn.includes("p_location_accuracy = 'Infinity'::DOUBLE PRECISION") &&
    createIncidentFn.includes("p_location_accuracy = '-Infinity'::DOUBLE PRECISION"),
    'create_incident explicitly rejects NaN, Infinity, -Infinity for location_accuracy'
  );
  assert(
    createIncidentFn.includes('p_location_accuracy < 0'),
    'create_incident rejects negative location_accuracy'
  );

  // Vehicle year validation
  assert(
    createIncidentFn.includes('p_vehicle_year < 1900 OR p_vehicle_year > 2100'),
    'create_incident validates vehicle year in 1900-2100 range'
  );

  // Operator manual intake provenance enforcement
  assert(
    createIncidentFn.includes("Only \"operator_manual\" is permitted") ||
    createIncidentFn.includes("p_location_source <> 'operator_manual'"),
    'create_incident enforces operator_manual contract for operator intake'
  );

  // Active capability validation
  assert(
    createIncidentFn.includes('public.service_capabilities') &&
    createIncidentFn.includes('id = p_required_capability_id') &&
    createIncidentFn.includes('is_active = true'),
    'create_incident validates required capability exists in service_capabilities and is_active = true'
  );

  // Calls reference number generator
  assert(
    createIncidentFn.includes('public.generate_incident_reference_number(v_caller_org)'),
    'create_incident calls generate_incident_reference_number with session organization'
  );

  // Initial status set to 'new'
  assert(createIncidentFn.includes("'new'"), 'create_incident sets initial status to "new"');

  // Atomic INCIDENT_CREATED operational event
  assert(
    createIncidentFn.includes("'INCIDENT_CREATED'"),
    'create_incident atomically writes INCIDENT_CREATED operational event'
  );
}

// ------------------------------------------------------------------------------
// SECTION 7: Privileges & Grants with Explicit Signatures
// ------------------------------------------------------------------------------
console.log('\n--- 7. Privileges & Grants with Explicit Signatures ---');

assert(
  phase4Sql.includes('REVOKE ALL ON FUNCTION public.transition_incident_status(UUID, TEXT, TEXT) FROM PUBLIC'),
  'PUBLIC execution is revoked on transition_incident_status(UUID, TEXT, TEXT)'
);
assert(
  phase4Sql.includes('REVOKE ALL ON FUNCTION public.transition_incident_status(UUID, TEXT, TEXT) FROM anon'),
  'anon execution is revoked on transition_incident_status(UUID, TEXT, TEXT)'
);
assert(
  phase4Sql.includes('GRANT EXECUTE ON FUNCTION public.transition_incident_status(UUID, TEXT, TEXT) TO authenticated'),
  'authenticated execution is granted on transition_incident_status(UUID, TEXT, TEXT)'
);

assert(
  phase4Sql.includes('REVOKE ALL ON FUNCTION public.create_incident('),
  'PUBLIC execution is revoked on create_incident with explicit arguments'
);
assert(
  phase4Sql.includes('FROM anon;') && phase4Sql.includes('public.create_incident('),
  'anon execution is revoked on create_incident'
);
assert(
  phase4Sql.includes('GRANT EXECUTE ON FUNCTION public.create_incident(') && phase4Sql.includes('TO authenticated;'),
  'authenticated execution is granted on create_incident'
);

// ------------------------------------------------------------------------------
// SECTION 8: Server Actions & Authorization
// ------------------------------------------------------------------------------
console.log('\n--- 8. Server Actions & Authorization ---');

const actionsPath = path.join(rootDir, 'src/lib/incidents/actions.ts');
assert(fs.existsSync(actionsPath), 'Server actions file exists', actionsPath);

const actionsContent = fs.readFileSync(actionsPath, 'utf8');
assert(actionsContent.includes("'use server'"), 'actions.ts is a Server Action module');
assert(actionsContent.includes('getCurrentUser()'), 'actions.ts validates authenticated session via getCurrentUser()');
assert(actionsContent.includes("role !== 'admin' && role !== 'operator'"), 'actions.ts blocks workers from operator intake/transitions');
assert(actionsContent.includes("rpc('create_incident'"), 'actions.ts invokes create_incident RPC');
assert(actionsContent.includes("rpc('transition_incident_status'"), 'actions.ts invokes transition_incident_status RPC');
assert(actionsContent.includes('revalidatePath'), 'actions.ts revalidates affected paths after mutations');
assert(
  actionsContent.includes("locationSource: LocationSource = 'operator_manual'") ||
  actionsContent.includes("locationSource = 'operator_manual'"),
  'actions.ts hardcodes locationSource to operator_manual'
);
assert(
  !actionsContent.includes("formData.get('location_source')"),
  'actions.ts does not trust arbitrary location_source from FormData'
);
assert(!actionsContent.includes('SUPABASE_SERVICE_ROLE_KEY'), 'actions.ts does not use service role key');

// ------------------------------------------------------------------------------
// SECTION 9: UI Components & Provenance Integrity
// ------------------------------------------------------------------------------
console.log('\n--- 9. UI Components & Provenance Integrity ---');

const queuePagePath = path.join(rootDir, 'src/app/(operator)/incidents/page.tsx');
const newPagePath = path.join(rootDir, 'src/app/(operator)/incidents/new/page.tsx');
const detailPagePath = path.join(rootDir, 'src/app/(operator)/incidents/[id]/page.tsx');
const intakeFormComponentPath = path.join(rootDir, 'src/components/incidents/incident-intake-form.tsx');
const transitionControlsComponentPath = path.join(rootDir, 'src/components/incidents/incident-transition-controls.tsx');

assert(fs.existsSync(queuePagePath), 'Queue page (/incidents) exists', queuePagePath);
assert(fs.existsSync(newPagePath), 'Intake page (/incidents/new) exists', newPagePath);
assert(fs.existsSync(detailPagePath), 'Detail page (/incidents/[id]) exists', detailPagePath);
assert(fs.existsSync(intakeFormComponentPath), 'Intake form component exists', intakeFormComponentPath);
assert(fs.existsSync(transitionControlsComponentPath), 'Transition controls component exists', transitionControlsComponentPath);

const intakeContent = fs.readFileSync(intakeFormComponentPath, 'utf8');
assert(
  !intakeContent.includes('customer_link') && !intakeContent.includes('telephony_intake') && !intakeContent.includes('device_gps'),
  'Intake form does NOT offer customer_link, telephony_intake, or device_gps dropdown options'
);

const detailContent = fs.readFileSync(detailPagePath, 'utf8');
assert(
  detailContent.includes("incident.location_source ?? 'Not recorded'") ||
  detailContent.includes("incident.location_source ? incident.location_source : 'Not recorded'"),
  'Detail page renders "Not recorded" for null location_source (no fallback to operator_manual)'
);
assert(
  detailContent.includes('incident.location_accuracy !== null') && detailContent.includes('incident.location_accuracy !== undefined'),
  'Detail page checks explicit null/undefined for location_accuracy so numeric 0 renders correctly'
);

// ------------------------------------------------------------------------------
// SECTION 10: Queue Page Accuracy (No Raw DB Errors, No False Realtime Claims)
// ------------------------------------------------------------------------------
console.log('\n--- 10. Queue Page Accuracy & Error Hygiene ---');

const queueContent = fs.readFileSync(queuePagePath, 'utf8');
assert(!queueContent.includes('DEMO_INCIDENTS'), 'Queue page contains no hardcoded demo incidents list');
assert(queueContent.includes(".from('incidents')"), 'Queue page queries real incidents from database');
assert(
  !queueContent.includes('queryError = error.message'),
  'Queue page does NOT assign raw database error.message directly to user-visible error state'
);
assert(
  !queueContent.includes('Real-time roadside operations queue'),
  'Queue page metadata does NOT falsely claim real-time subscriptions'
);
assert(
  queueContent.includes('Database-backed roadside operations queue'),
  'Queue page metadata accurately describes database-backed operations queue'
);

// ------------------------------------------------------------------------------
// SECTION 11: Seed Execution Order & Content
// ------------------------------------------------------------------------------
console.log('\n--- 11. Seed Execution Order & Content ---');

const seedPath = path.join(rootDir, 'supabase/seed.sql');
const seedContent = fs.readFileSync(seedPath, 'utf8');

assert(
  seedContent.includes('Phase 4 migration:') && seedContent.includes('20260929140000_phase4_incident_state_machine.sql'),
  'Seed header specifies Phase 4 migration before seed script execution'
);
assert(
  seedContent.includes("'new'"),
  'Seed synthetic incident uses "new" status'
);
assert(
  seedContent.includes("'device_gps'"),
  'Seed synthetic incident retains "device_gps" provenance'
);

// ------------------------------------------------------------------------------
// SECTION 12: Phase Boundary Enforcement (No Phase 5-10 Premature Code)
// ------------------------------------------------------------------------------
console.log('\n--- 12. Phase Boundary Enforcement ---');

const clientSrcFiles = [
  queuePagePath,
  newPagePath,
  detailPagePath,
  intakeFormComponentPath,
  transitionControlsComponentPath,
  actionsPath,
];

for (const filePath of clientSrcFiles) {
  const content = fs.readFileSync(filePath, 'utf8');
  const baseName = path.basename(filePath);

  assert(!content.includes('mapbox-gl') && !content.includes('react-map-gl'), `No Mapbox in ${baseName}`);
  assert(!content.includes('recommend_dispatch') && !content.includes('calculate_dispatch_score'), `No dispatch scoring in ${baseName}`);
  assert(!content.includes('serviceWorker') && !content.includes('workbox'), `No worker service worker in ${baseName}`);
  assert(!content.includes('capture_customer_location'), `No customer GPS token capture workflow in ${baseName}`);
  assert(!content.includes('twilio') && !content.includes('vapi'), `No telephony integration in ${baseName}`);
}

// ------------------------------------------------------------------------------
// SUMMARY REPORT
// ------------------------------------------------------------------------------
console.log('\n================================================================');
console.log(`  VERIFICATION COMPLETE: ${passedChecks} PASSED, ${failedChecks} FAILED (TOTAL: ${totalChecks})`);
console.log('================================================================');

if (failedChecks > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
