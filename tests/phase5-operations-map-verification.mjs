/**
 * ==============================================================================
 * MATOS SYSTEMS — PHASE 5 OPERATIONAL MAPPING & FLEET TELEMETRY FOUNDATION
 * STATIC ARCHITECTURAL, SECURITY, SCHEMA & INTERACTION VERIFICATION SUITE
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
console.log('  MATOS SYSTEMS — PHASE 5 OPERATIONS MAP VERIFICATION SUITE     ');
console.log('================================================================');

// ------------------------------------------------------------------------------
// SECTION 0: Historical Migration Isolation & Ordering
// ------------------------------------------------------------------------------
console.log('\n--- 0. Historical Migration Isolation & Execution Order ---');

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

assert(fs.existsSync(phase2MigrationPath), 'Phase 2 migration file exists', phase2MigrationPath);
assert(fs.existsSync(phase3MigrationPath), 'Phase 3 migration file exists', phase3MigrationPath);
assert(fs.existsSync(phase4MigrationPath), 'Phase 4 migration file exists', phase4MigrationPath);
assert(fs.existsSync(phase5MigrationPath), 'Phase 5 migration file exists', phase5MigrationPath);

const p4Base = path.basename(phase4MigrationPath);
const p5Base = path.basename(phase5MigrationPath);
assert(
  p5Base > p4Base,
  `Phase 5 migration (${p5Base}) executes after Phase 4 (${p4Base}) by filename ordering`
);

const phase5Sql = fs.readFileSync(phase5MigrationPath, 'utf8');

// ------------------------------------------------------------------------------
// SECTION 1: Database RPC Contract & Security (get_operations_map_snapshot)
// ------------------------------------------------------------------------------
console.log('\n--- 1. Snapshot RPC Contract, Signature & Security ---');

assert(
  phase5Sql.includes('CREATE OR REPLACE FUNCTION public.get_operations_map_snapshot()'),
  'Defines get_operations_map_snapshot() function'
);

assert(
  /CREATE OR REPLACE FUNCTION public\.get_operations_map_snapshot\(\s*\)/i.test(phase5Sql),
  'Enforces exact ZERO-PARAMETER signature (no client-supplied tenant parameter)'
);

assert(
  /RETURNS\s+JSONB/i.test(phase5Sql),
  'Function return type is explicitly RETURNS JSONB'
);

assert(
  /SECURITY\s+DEFINER/i.test(phase5Sql),
  'Function declared as SECURITY DEFINER'
);

assert(
  /SET\s+search_path\s*=\s*public,\s*extensions/i.test(phase5Sql),
  'Sets safe search_path = public, extensions'
);

assert(
  phase5Sql.includes('auth.uid()'),
  'Derives caller UID strictly from authenticated session via auth.uid()'
);

assert(
  phase5Sql.includes('public.get_current_user_organization_id()'),
  'Derives tenant organization strictly from session via get_current_user_organization_id()'
);

assert(
  phase5Sql.includes('public.get_current_user_role()'),
  'Derives user role strictly from session via get_current_user_role()'
);

assert(
  phase5Sql.includes("v_caller_role NOT IN ('admin', 'operator')"),
  'Restricts snapshot access strictly to admin and operator roles (workers rejected)'
);

assert(
  phase5Sql.includes('REVOKE ALL ON FUNCTION public.get_operations_map_snapshot() FROM PUBLIC;'),
  'Revokes execution from PUBLIC'
);

assert(
  phase5Sql.includes('REVOKE ALL ON FUNCTION public.get_operations_map_snapshot() FROM anon;'),
  'Revokes execution from anonymous clients (anon)'
);

assert(
  phase5Sql.includes('GRANT EXECUTE ON FUNCTION public.get_operations_map_snapshot() TO authenticated;'),
  'Grants execution to authenticated users'
);

// ------------------------------------------------------------------------------
// SECTION 2: Exact Active Incident Scoping & Aggregate-Level Deterministic Ordering
// ------------------------------------------------------------------------------
console.log('\n--- 2. Active Incident Status Boundary & Aggregate Deterministic Ordering ---');

const activeStatuses = [
  'new',
  'triaged',
  'ready_for_dispatch',
  'dispatched',
  'en_route',
  'on_scene',
  'in_progress',
];

for (const status of activeStatuses) {
  assert(
    phase5Sql.includes(`'${status}'`),
    `Snapshot RPC includes active status '${status}'`
  );
}

const terminalStatuses = ['completed', 'cancelled', 'unable_to_complete'];
for (const status of terminalStatuses) {
  const statusMatch = phase5Sql.match(/i\.status\s+IN\s*\(([^)]+)\)/i);
  if (statusMatch) {
    const includedStatuses = statusMatch[1];
    assert(
      !includedStatuses.includes(`'${status}'`),
      `Snapshot incident query excludes terminal status '${status}'`
    );
  }
}

const incidentWhere =
  phase5Sql.match(/FROM\s+public\.incidents\s+i[\s\S]*?WHERE([\s\S]*?)\),/i)?.[1] ?? '';
assert(
  !/location\s+IS\s+NOT\s+NULL/i.test(incidentWhere),
  'Incident query does NOT require location IS NOT NULL for snapshot membership (missing-location incidents retained)'
);

// Scoped assertion: aggregate-level ORDER BY inside jsonb_agg for incidents
const incidentAggMatch = phase5Sql.match(
  /'incidents'\s*,\s*COALESCE\s*\(\s*\(\s*SELECT\s+jsonb_agg\([\s\S]*?\)\s*FROM\s+incident_records\s+r/i
);
assert(
  Boolean(incidentAggMatch),
  'Snapshot RPC constructs incidents JSON array using jsonb_agg from incident_records r'
);

if (incidentAggMatch) {
  const incidentAggSql = incidentAggMatch[0];
  assert(
    /jsonb_agg\([\s\S]*?ORDER\s+BY[\s\S]*?CASE\s+r\.priority[\s\S]*?'critical'[\s\S]*?'high'[\s\S]*?'standard'[\s\S]*?'low'[\s\S]*?r\.created_at\s+ASC[\s\S]*?r\.id\s+ASC[\s\S]*?\)\s*FROM\s+incident_records\s+r/i.test(
      incidentAggSql
    ),
    'Incident array enforces aggregate-level ORDER BY inside jsonb_agg (priority -> created_at -> id)'
  );
}

// ------------------------------------------------------------------------------
// SECTION 3: Active Fleet Scoping & Vehicle Aggregate-Level Ordering
// ------------------------------------------------------------------------------
console.log('\n--- 3. Active Fleet Scoping & Vehicle Aggregate Ordering ---');

assert(
  /v\.is_active\s*=\s*true/i.test(phase5Sql),
  'Filters fleet vehicles to active response units only (is_active = true)'
);

const vehicleWhere =
  phase5Sql.match(/FROM\s+public\.vehicles\s+v[\s\S]*?WHERE([\s\S]*?)\)/i)?.[1] ?? '';
assert(
  !/last_known_location\s+IS\s+NOT\s+NULL/i.test(vehicleWhere),
  'Vehicle query does NOT require last_known_location IS NOT NULL for snapshot membership (unmapped vehicles retained)'
);

// Scoped assertion: aggregate-level ORDER BY inside jsonb_agg for vehicles
const vehicleAggMatch = phase5Sql.match(
  /'vehicles'\s*,\s*COALESCE\s*\(\s*\(\s*SELECT\s+jsonb_agg\([\s\S]*?\)\s*FROM\s+vehicle_records\s+vr/i
);
assert(
  Boolean(vehicleAggMatch),
  'Snapshot RPC constructs vehicles JSON array using jsonb_agg from vehicle_records vr'
);

if (vehicleAggMatch) {
  const vehicleAggSql = vehicleAggMatch[0];
  assert(
    /jsonb_agg\([\s\S]*?ORDER\s+BY[\s\S]*?vr\.callsign\s+ASC[\s\S]*?vr\.id\s+ASC[\s\S]*?\)\s*FROM\s+vehicle_records\s+vr/i.test(
      vehicleAggSql
    ),
    'Vehicle array enforces aggregate-level ORDER BY inside jsonb_agg (vr.callsign ASC, vr.id ASC)'
  );
}

assert(
  phase5Sql.includes('public.vehicle_capabilities') &&
    phase5Sql.includes('public.service_capabilities'),
  'Vehicle capabilities aggregated from vehicle_capabilities joined with service_capabilities'
);

assert(
  /sc\.is_active\s*=\s*true/i.test(phase5Sql),
  'Vehicle capabilities filtered to active service capability catalogue entries'
);

// ------------------------------------------------------------------------------
// SECTION 4: PostGIS Coordinate Derivation & Schema Discipline
// ------------------------------------------------------------------------------
console.log('\n--- 4. PostGIS Coordinate Derivation & Schema Hygiene ---');

assert(
  /ST_X\(i\.location::geometry\)/i.test(phase5Sql) ||
    /ST_X\(\s*location::geometry\s*\)/i.test(phase5Sql),
  'Extracts incident longitude using PostGIS ST_X with geometry cast'
);

assert(
  /ST_Y\(i\.location::geometry\)/i.test(phase5Sql) ||
    /ST_Y\(\s*location::geometry\s*\)/i.test(phase5Sql),
  'Extracts incident latitude using PostGIS ST_Y with geometry cast'
);

assert(
  /ST_X\(v\.last_known_location::geometry\)/i.test(phase5Sql) ||
    /ST_X\(\s*last_known_location::geometry\s*\)/i.test(phase5Sql),
  'Extracts vehicle longitude using PostGIS ST_X with geometry cast'
);

assert(
  /ST_Y\(v\.last_known_location::geometry\)/i.test(phase5Sql) ||
    /ST_Y\(\s*last_known_location::geometry\s*\)/i.test(phase5Sql),
  'Extracts vehicle latitude using PostGIS ST_Y with geometry cast'
);

// Prohibit duplicate coordinate column creation
assert(
  !/ADD\s+COLUMN\s+.*(latitude|longitude|incident_lat|incident_lng|vehicle_lat|vehicle_lng)/i.test(
    phase5Sql
  ),
  'Zero duplicate coordinate storage columns added (PostGIS geography remains authoritative)'
);

// Prohibit new database tables
assert(
  !/CREATE\s+TABLE\s+/i.test(phase5Sql),
  'Zero new database tables created in Phase 5 migration'
);

// ------------------------------------------------------------------------------
// SECTION 5: Read-Only RPC Guarantee
// ------------------------------------------------------------------------------
console.log('\n--- 5. Read-Only RPC Guarantee ---');

assert(
  !/INSERT\s+INTO\s+public\.incidents/i.test(phase5Sql),
  'RPC contains no INSERT statements against incidents'
);
assert(
  !/UPDATE\s+public\.incidents/i.test(phase5Sql),
  'RPC contains no UPDATE statements against incidents'
);
assert(
  !/DELETE\s+FROM\s+public\.incidents/i.test(phase5Sql),
  'RPC contains no DELETE statements against incidents'
);
assert(
  !/INSERT\s+INTO\s+public\.vehicles/i.test(phase5Sql),
  'RPC contains no INSERT statements against vehicles'
);
assert(
  !/UPDATE\s+public\.vehicles/i.test(phase5Sql),
  'RPC contains no UPDATE statements against vehicles'
);
assert(
  !/DELETE\s+FROM\s+public\.vehicles/i.test(phase5Sql),
  'RPC contains no DELETE statements against vehicles'
);
assert(
  !/INSERT\s+INTO\s+public\.assignments/i.test(phase5Sql),
  'RPC contains no INSERT statements against assignments'
);
assert(
  !/INSERT\s+INTO\s+public\.operational_events/i.test(phase5Sql),
  'RPC contains no INSERT statements against operational_events'
);

// ------------------------------------------------------------------------------
// SECTION 6: Snapshot Payload Contract & Tenant Hygiene
// ------------------------------------------------------------------------------
console.log('\n--- 6. Snapshot Payload Contract & Tenant Hygiene ---');

assert(
  phase5Sql.includes("'generated_at'"),
  "Snapshot top-level payload includes 'generated_at'"
);
assert(
  phase5Sql.includes("'incidents'"),
  "Snapshot top-level payload includes 'incidents'"
);
assert(
  phase5Sql.includes("'vehicles'"),
  "Snapshot top-level payload includes 'vehicles'"
);

const requiredIncidentKeys = [
  'id',
  'reference_number',
  'status',
  'priority',
  'service_type',
  'customer_name',
  'customer_phone',
  'location_address',
  'latitude',
  'longitude',
  'location_accuracy',
  'location_source',
  'required_capability',
  'vehicle_registration',
  'vehicle_make',
  'vehicle_model',
  'vehicle_year',
  'vehicle_color',
  'notes',
  'created_at',
  'updated_at',
];

for (const key of requiredIncidentKeys) {
  assert(
    phase5Sql.includes(`'${key}',`),
    `Incident JSON payload includes required contract key '${key}'`
  );
}

const requiredVehicleKeys = [
  'id',
  'callsign',
  'registration_number',
  'is_active',
  'latitude',
  'longitude',
  'location_updated_at',
  'capabilities',
];

for (const key of requiredVehicleKeys) {
  assert(
    phase5Sql.includes(`'${key}',`),
    `Vehicle JSON payload includes required contract key '${key}'`
  );
}

// Tenant leakage prevention: organization_id must NOT be exposed in frontend payload
assert(
  !/'organization_id',\s*r\.organization_id/i.test(phase5Sql) &&
    !/'organization_id',\s*vr\.organization_id/i.test(phase5Sql),
  'Snapshot JSON payload does not expose organization_id in incidents or vehicles'
);

// ------------------------------------------------------------------------------
// SECTION 7: Frontend Architecture & Expected Phase 5 Files
// ------------------------------------------------------------------------------
console.log('\n--- 7. Frontend Architecture & File Structure ---');

const expectedFiles = [
  'src/lib/operations/data.ts',
  'src/lib/operations/actions.ts',
  'src/components/operations/operations-workspace.tsx',
  'src/components/operations/incident-queue.tsx',
  'src/components/operations/operations-map.tsx',
  'src/components/operations/operations-context-panel.tsx',
  'src/app/(operator)/operations/page.tsx',
  'supabase/verify_phase5.sql',
];

for (const relPath of expectedFiles) {
  const fullPath = path.join(rootDir, relPath);
  assert(fs.existsSync(fullPath), `Expected file exists: ${relPath}`);
}

const operationsPagePath = path.join(rootDir, 'src/app/(operator)/operations/page.tsx');
const operationsPageContent = fs.readFileSync(operationsPagePath, 'utf8');

assert(
  !operationsPageContent.includes("'use client'"),
  '/operations/page.tsx remains a Server Component (no use client directive)'
);

assert(
  operationsPageContent.includes('getOperationsSnapshot'),
  '/operations/page.tsx invokes authoritative getOperationsSnapshot() data loader'
);

const workspacePath = path.join(
  rootDir,
  'src/components/operations/operations-workspace.tsx'
);
const workspaceContent = fs.readFileSync(workspacePath, 'utf8');

assert(
  workspaceContent.includes("'use client'"),
  'operations-workspace.tsx is a client coordinator (use client)'
);

const mapComponentPath = path.join(
  rootDir,
  'src/components/operations/operations-map.tsx'
);
const mapComponentContent = fs.readFileSync(mapComponentPath, 'utf8');

assert(
  mapComponentContent.includes("'use client'"),
  'operations-map.tsx is a dedicated client component (use client)'
);

assert(
  mapComponentContent.includes("from 'mapbox-gl'") ||
    mapComponentContent.includes('import mapboxgl'),
  'operations-map.tsx imports official mapbox-gl package'
);

// Prohibit unauthorized map frameworks
const packageJson = JSON.parse(
  fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')
);
const allDeps = {
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
};

assert('mapbox-gl' in allDeps, 'package.json includes mapbox-gl');
assert(!('react-map-gl' in allDeps), 'package.json rejects react-map-gl');
assert(!('leaflet' in allDeps), 'package.json rejects leaflet');
assert(!('react-leaflet' in allDeps), 'package.json rejects react-leaflet');
assert(!('@react-google-maps/api' in allDeps), 'package.json rejects Google Maps libraries');

// Verify environment template contains NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN
const envExample = fs.readFileSync(path.join(rootDir, '.env.example'), 'utf8');
assert(
  envExample.includes('NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN='),
  '.env.example includes NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN template'
);

// Security hygiene: zero hardcoded mapbox public or secret tokens
const phase5SrcFiles = [
  'src/lib/operations/data.ts',
  'src/lib/operations/actions.ts',
  'src/components/operations/operations-workspace.tsx',
  'src/components/operations/incident-queue.tsx',
  'src/components/operations/operations-map.tsx',
  'src/components/operations/operations-context-panel.tsx',
  'src/app/(operator)/operations/page.tsx',
  'src/lib/env.ts',
];

for (const relPath of phase5SrcFiles) {
  const content = fs.readFileSync(path.join(rootDir, relPath), 'utf8');
  assert(
    !/pk\.[a-zA-Z0-9_-]{20,}/.test(content),
    `No hardcoded Mapbox public token in ${relPath}`
  );
  assert(
    !/sk\.[a-zA-Z0-9_-]{20,}/.test(content),
    `No secret (sk-prefixed) Mapbox token in ${relPath}`
  );
  assert(
    !content.includes('service_role') && !content.includes('SUPABASE_SERVICE_ROLE_KEY'),
    `No service role key referenced in ${relPath}`
  );
}

// ------------------------------------------------------------------------------
// SECTION 8: Shared Server Data Layer & Actions
// ------------------------------------------------------------------------------
console.log('\n--- 8. Shared Server Data Layer & Refresh Action ---');

const dataContent = fs.readFileSync(path.join(rootDir, 'src/lib/operations/data.ts'), 'utf8');
assert(
  dataContent.includes("rpc('get_operations_map_snapshot')"),
  'data.ts invokes get_operations_map_snapshot RPC'
);

assert(
  dataContent.includes('getCurrentUser()'),
  'data.ts verifies session via getCurrentUser() helper'
);

assert(
  dataContent.includes("role !== 'admin' && role !== 'operator'"),
  'data.ts rejects unauthorized non-admin/operator roles'
);

assert(
  !dataContent.includes('raw_error') &&
    !dataContent.includes('error.message') &&
    dataContent.includes('SNAPSHOT_UNAVAILABLE'),
  'data.ts prevents leaking raw database error messages to callers'
);

// Data validation: never fabricate operational values
assert(
  !dataContent.includes('new Date().toISOString()'),
  'data.ts contains zero timestamp fabrication (no new Date().toISOString() fallbacks)'
);

assert(
  !/customer_phone:\s*typeof\s+inc\.customer_phone\s*===\s*'string'\s*\?\s*inc\.customer_phone\s*:\s*''/i.test(dataContent) &&
    !/customer_phone:\s*''/i.test(dataContent),
  'data.ts does not substitute empty string for missing or malformed customer_phone'
);

assert(
  dataContent.includes('inc.customer_phone') &&
    dataContent.includes('inc.created_at') &&
    dataContent.includes('inc.updated_at') &&
    dataContent.includes('INVALID_SNAPSHOT'),
  'data.ts validates required incident fields (phone, timestamps) and returns INVALID_SNAPSHOT on malformed input'
);

const actionContent = fs.readFileSync(
  path.join(rootDir, 'src/lib/operations/actions.ts'),
  'utf8'
);
assert(
  actionContent.includes("'use server'"),
  'actions.ts is a Server Action module (use server)'
);
assert(
  actionContent.includes('getOperationsSnapshot()'),
  'actions.ts delegates refresh to authoritative getOperationsSnapshot() loader'
);
assert(
  !actionContent.includes("rpc('get_operations_map_snapshot')"),
  'actions.ts does not duplicate RPC execution logic'
);

// Client components must not query Supabase directly
const clientOpsComponents = [
  'src/components/operations/operations-workspace.tsx',
  'src/components/operations/incident-queue.tsx',
  'src/components/operations/operations-map.tsx',
  'src/components/operations/operations-context-panel.tsx',
];

for (const relPath of clientOpsComponents) {
  const content = fs.readFileSync(path.join(rootDir, relPath), 'utf8');
  assert(
    !content.includes('@supabase/supabase-js') &&
      !content.includes('@supabase/ssr') &&
      !content.includes("from '@/lib/supabase/client'"),
    `Client component ${relPath} does not query Supabase directly`
  );
}

// ------------------------------------------------------------------------------
// SECTION 9: Selection Model & Queue Interaction
// ------------------------------------------------------------------------------
console.log('\n--- 9. Selection Model & Queue Interaction ---');

const typesContent = fs.readFileSync(path.join(rootDir, 'src/types/index.ts'), 'utf8');

assert(
  typesContent.includes("type OperationsSelection ="),
  'Defines strongly typed OperationsSelection in src/types/index.ts'
);

assert(
  typesContent.includes("{ type: 'incident'; id: string }") &&
    typesContent.includes("{ type: 'vehicle'; id: string }"),
  'Selection model is ID-based and distinguishes incident and vehicle entities'
);

// Workspace selection reconciliation: real selection clearing
assert(
  workspaceContent.includes('setSelection(null)') &&
    (workspaceContent.includes('stillVisible') || workspaceContent.includes('filteredIncidents.some')),
  'operations-workspace.tsx performs real selection state clearing (setSelection(null)) when selected incident is filtered'
);

assert(
  !workspaceContent.includes('activeSelection'),
  'operations-workspace.tsx does not rely on a derived activeSelection mask that masks without clearing state'
);

const queueContent = fs.readFileSync(
  path.join(rootDir, 'src/components/operations/incident-queue.tsx'),
  'utf8'
);

assert(
  queueContent.includes('statusFilter') &&
    queueContent.includes('priorityFilter') &&
    queueContent.includes('serviceFilter'),
  'IncidentQueue provides client-side filters for status, priority, and service type'
);

assert(
  queueContent.includes('searchQuery'),
  'IncidentQueue provides operational text search'
);

assert(
  !queueContent.includes('DEMO_INCIDENTS') && !queueContent.includes('MOCK_INCIDENTS'),
  'IncidentQueue operates strictly on genuine snapshot data (no hardcoded demo rows)'
);

for (const terminalStatus of terminalStatuses) {
  assert(
    !queueContent.includes(`value="${terminalStatus}"`),
    `IncidentQueue filter UI excludes terminal state '${terminalStatus}'`
  );
}

assert(
  queueContent.includes('Missing location'),
  'IncidentQueue renders explicit missing-location indicator for unmapped incidents'
);

// ------------------------------------------------------------------------------
// SECTION 10: Mapbox Behavior, Markers & Failure Degradation
// ------------------------------------------------------------------------------
console.log('\n--- 10. Mapbox Behavior, Markers & Failure Degradation ---');

assert(
  mapComponentContent.includes('NavigationControl'),
  'OperationsMap initializes Mapbox NavigationControl'
);

assert(
  mapComponentContent.includes('fitOperationalArea'),
  'OperationsMap implements Fit operational area bounding behavior'
);

assert(
  mapComponentContent.includes('onSelectIncident') &&
    mapComponentContent.includes('onSelectVehicle'),
  'OperationsMap implements distinct selection handlers for incidents and vehicles'
);

assert(
  mapComponentContent.includes('onClearSelection'),
  'OperationsMap clears selection on neutral background map click'
);

assert(
  mapComponentContent.includes('isMapboxConfigured'),
  'OperationsMap verifies isMapboxConfigured before rendering'
);

assert(
  mapComponentContent.includes('Mapbox access token is not configured'),
  'OperationsMap renders informative fallback message when token is not configured'
);

assert(
  mapComponentContent.includes('Retry Map'),
  'OperationsMap provides localized Retry Map action upon initialization error'
);

// ------------------------------------------------------------------------------
// SECTION 11: Context Panel & Truthful Telemetry Language
// ------------------------------------------------------------------------------
console.log('\n--- 11. Context Panel & Truthful Vehicle Position Language ---');

const contextContent = fs.readFileSync(
  path.join(rootDir, 'src/components/operations/operations-context-panel.tsx'),
  'utf8'
);

assert(
  contextContent.includes('Operations Overview'),
  'Context panel renders default operational overview when nothing is selected'
);

assert(
  contextContent.includes('Incident Context') &&
    contextContent.includes('Open full incident record →'),
  'Context panel renders incident detail with link to full record /incidents/[id]'
);

assert(
  contextContent.includes('Fleet Unit Context'),
  'Context panel renders vehicle detail panel when unit is selected'
);

assert(
  contextContent.includes('Last known location') ||
    contextContent.includes('Last Known Location'),
  'Context panel strictly uses truthful "Last known location" terminology'
);

assert(
  contextContent.includes('Vehicle positions show the latest stored location and are not a live GPS feed'),
  'Context panel includes explicit disclaimer that vehicle positions are not a live GPS feed'
);

// Vehicle position wording verification across operations UI files
const opsUiFiles = [
  'src/components/operations/operations-workspace.tsx',
  'src/components/operations/incident-queue.tsx',
  'src/components/operations/operations-map.tsx',
  'src/components/operations/operations-context-panel.tsx',
];

for (const relPath of opsUiFiles) {
  const content = fs.readFileSync(path.join(rootDir, relPath), 'utf8');
  // Strip approved negative disclaimers ("not a live GPS feed") before checking for misleading claims
  const sanitized = content.replace(/not\s+(?:a\s+)?live\s+gps(\s+feed)?/gi, '');
  assert(
    !/live\s+(telemetry|GPS|tracking|location)/i.test(sanitized),
    `${relPath} does not describe current vehicle positions as live GPS or live telemetry`
  );
}

// ------------------------------------------------------------------------------
// SECTION 12: SQL Verifier Privilege Inspection Integrity
// ------------------------------------------------------------------------------
console.log('\n--- 12. SQL Verifier Privilege Inspection Integrity ---');

const verify5Sql = fs.readFileSync(path.join(rootDir, 'supabase/verify_phase5.sql'), 'utf8');
assert(
  verify5Sql.includes('aclexplode') && verify5Sql.includes('acl.grantee = 0'),
  'verify_phase5.sql checks PUBLIC EXECUTE privilege using aclexplode catalog inspection (grantee = 0)'
);
assert(
  !verify5Sql.includes("has_function_privilege('public'"),
  'verify_phase5.sql does not use has_function_privilege with "public" role string'
);

// ------------------------------------------------------------------------------
// SECTION 13: Strict Phase Boundary Verification (No Phase 6+ Implementations)
// ------------------------------------------------------------------------------
console.log('\n--- 13. Strict Phase Boundaries (No Premature Phase 6-9 Logic) ---');

const phase6Patterns = [
  { pattern: /recommend_dispatch/i, desc: 'recommend_dispatch' },
  { pattern: /calculate_dispatch_score/i, desc: 'calculate_dispatch_score' },
  { pattern: /match_score/i, desc: 'match_score' },
  { pattern: /recommended_vehicle/i, desc: 'recommended_vehicle' },
  { pattern: /automatic\s+assignment/i, desc: 'automatic assignment' },
  { pattern: /best_unit/i, desc: 'best unit scoring' },
  { pattern: /capture_customer_location/i, desc: 'Phase 8 customer GPS capture' },
  { pattern: /navigator\.geolocation\.watchPosition/i, desc: 'Phase 7 background GPS watching' },
  { pattern: /twilio/i, desc: 'Phase 9 Twilio integration' },
  { pattern: /vapi/i, desc: 'Phase 9 Vapi integration' },
  { pattern: /postgres_changes/i, desc: 'Supabase realtime postgres_changes' },
];

for (const relPath of phase5SrcFiles) {
  const content = fs.readFileSync(path.join(rootDir, relPath), 'utf8');
  for (const { pattern, desc } of phase6Patterns) {
    assert(
      !pattern.test(content),
      `File ${relPath} does not contain premature ${desc}`
    );
  }
}

// ------------------------------------------------------------------------------
// SUMMARY
// ------------------------------------------------------------------------------
console.log('\n================================================================');
console.log(`  PHASE 5 VERIFICATION RESULTS: ${passedChecks} PASSED, ${failedChecks} FAILED (TOTAL: ${totalChecks})`);
console.log('================================================================\n');

if (failedChecks > 0) {
  console.error(`FAILURE: ${failedChecks} Phase 5 checks failed.`);
  process.exit(1);
} else {
  console.log(`SUCCESS: All ${passedChecks} Phase 5 architectural checks passed cleanly.`);
  process.exit(0);
}
