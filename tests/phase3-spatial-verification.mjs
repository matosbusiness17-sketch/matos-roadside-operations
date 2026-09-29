/**
 * ==============================================================================
 * MATOS SYSTEMS — PHASE 3 SPATIAL SCHEMA & CAPABILITIES VERIFICATION SUITE
 * ==============================================================================
 * Static architectural and security inspection for Phase 3 database extensions:
 * 1. PostGIS extensions and spatial types
 * 2. Authoritative geography(Point, 4326) columns on incidents and vehicles
 * 3. Spatial GiST indexing
 * 4. Capabilities schema and composite tenant foreign keys
 * 5. Role-aware vehicle_capabilities SELECT RLS (Worker isolation verification)
 * 6. vehicle_capabilities write policies (INSERT/UPDATE/DELETE) with USING and WITH CHECK
 * 7. service_capabilities catalogue RLS
 * 8. calculate_incident_vehicle_distance role boundaries and tenant confinement
 * 9. get_nearby_vehicles input validation (coordinates, radius bounds, NaN/Inf)
 * 10. get_nearby_vehicles_for_incident security and delegation
 * 11. Security Definer safe search_path and PUBLIC privilege revocations
 * 12. Phase 4+ isolation boundaries
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

function pass(description) {
  totalChecks++;
  passedChecks++;
  console.log(`[PASS] ${description}`);
}

function fail(description, reason) {
  totalChecks++;
  failedChecks++;
  console.error(`[FAIL] ${description} -> ${reason}`);
}

function assert(condition, description, failReason) {
  if (condition) {
    pass(description);
  } else {
    fail(description, failReason || 'Condition evaluated to false');
  }
}

function extractPolicy(sql, policyName) {
  const regex = new RegExp(`CREATE\\s+POLICY\\s+"${policyName}"[\\s\\S]*?;`, 'i');
  const match = sql.match(regex);
  return match ? match[0] : null;
}

function extractFunction(sql, functionName) {
  const regex = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${functionName}[\\s\\S]*?\\$\\$;`, 'i');
  const match = sql.match(regex);
  return match ? match[0] : null;
}

console.log('================================================================');
console.log('  MATOS SYSTEMS — PHASE 3 SPATIAL & CAPABILITIES VERIFICATION  ');
console.log('================================================================\n');

// Load Phase 3 migration file
const migrationPath = path.join(
  rootDir,
  'supabase',
  'migrations',
  '20260929120000_phase3_spatial_and_capabilities.sql'
);

assert(fs.existsSync(migrationPath), 'Phase 3 migration file exists', 'Migration file missing at ' + migrationPath);

let migrationSql = '';
if (fs.existsSync(migrationPath)) {
  migrationSql = fs.readFileSync(migrationPath, 'utf8');
}

// ------------------------------------------------------------------------------
// 1. PostGIS Extension & Spatial Schema Foundation
// ------------------------------------------------------------------------------
console.log('--- 1. PostGIS Extension & Spatial Data Types ---');

assert(
  /CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+postgis/i.test(migrationSql),
  'PostGIS spatial extension enabled via CREATE EXTENSION IF NOT EXISTS postgis',
  'PostGIS extension creation missing'
);

assert(
  /ALTER\s+TABLE\s+public\.vehicles\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+last_known_location\s+geography\(Point,\s*4326\)/i.test(migrationSql),
  'vehicles.last_known_location defined as authoritative geography(Point, 4326)',
  'vehicles last_known_location definition missing or not geography(Point, 4326)'
);

assert(
  /ALTER\s+TABLE\s+public\.vehicles\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+location_updated_at\s+TIMESTAMPTZ/i.test(migrationSql),
  'vehicles.location_updated_at defined as TIMESTAMPTZ',
  'vehicles location_updated_at column definition missing'
);

assert(
  /ALTER\s+TABLE\s+public\.incidents\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+location\s+geography\(Point,\s*4326\)/i.test(migrationSql),
  'incidents.location defined as authoritative geography(Point, 4326)',
  'incidents location definition missing or not geography(Point, 4326)'
);

assert(
  /ALTER\s+TABLE\s+public\.incidents\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+location_accuracy\s+DOUBLE\s+PRECISION/i.test(migrationSql),
  'incidents.location_accuracy defined as DOUBLE PRECISION',
  'incidents location_accuracy missing'
);

assert(
  /ALTER\s+TABLE\s+public\.incidents\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+location_source\s+TEXT/i.test(migrationSql),
  'incidents.location_source defined as TEXT',
  'incidents location_source missing'
);

assert(
  /ALTER\s+TABLE\s+public\.incidents\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+vehicle_registration\s+TEXT/i.test(migrationSql) &&
  /ALTER\s+TABLE\s+public\.incidents\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+vehicle_make\s+TEXT/i.test(migrationSql) &&
  /ALTER\s+TABLE\s+public\.incidents\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+vehicle_model\s+TEXT/i.test(migrationSql) &&
  /ALTER\s+TABLE\s+public\.incidents\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+vehicle_year\s+INTEGER/i.test(migrationSql) &&
  /ALTER\s+TABLE\s+public\.incidents\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+vehicle_color\s+TEXT/i.test(migrationSql),
  'incidents structured vehicle fields defined (registration, make, model, year, color)',
  'One or more incident vehicle fields are missing'
);

assert(
  /ALTER\s+TABLE\s+public\.incidents\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+required_capability_id\s+UUID\s+REFERENCES\s+public\.service_capabilities\(id\)/i.test(migrationSql),
  'incidents.required_capability_id references service_capabilities(id)',
  'incidents required_capability_id definition missing or incorrect'
);

// ------------------------------------------------------------------------------
// 2. Spatial GiST Indexes
// ------------------------------------------------------------------------------
console.log('\n--- 2. Spatial Indexing ---');

assert(
  /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_vehicles_last_known_location\s+ON\s+public\.vehicles\s+USING\s+GIST\s*\(\s*last_known_location\s*\)/i.test(migrationSql),
  'GiST index on vehicles(last_known_location) defined',
  'GiST index on vehicles last_known_location missing'
);

assert(
  /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_incidents_location\s+ON\s+public\.incidents\s+USING\s+GIST\s*\(\s*location\s*\)/i.test(migrationSql),
  'GiST index on incidents(location) defined',
  'GiST index on incidents location missing'
);

// ------------------------------------------------------------------------------
// 3. Capability Architecture & Tenant Integrity
// ------------------------------------------------------------------------------
console.log('\n--- 3. Capability Architecture & Tenancy ---');

assert(
  /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.service_capabilities/i.test(migrationSql),
  'service_capabilities catalogue table defined',
  'service_capabilities table missing'
);

assert(
  /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.vehicle_capabilities/i.test(migrationSql),
  'vehicle_capabilities junction table defined',
  'vehicle_capabilities table missing'
);

assert(
  /CONSTRAINT\s+fk_vehicle_capabilities_vehicle_org\s+FOREIGN\s+KEY\s*\(\s*vehicle_id\s*,\s*organization_id\s*\)\s+REFERENCES\s+public\.vehicles\s*\(\s*id\s*,\s*organization_id\s*\)/i.test(migrationSql),
  'vehicle_capabilities enforces composite foreign key (vehicle_id, organization_id) to vehicles',
  'Composite foreign key fk_vehicle_capabilities_vehicle_org missing or malformed'
);

assert(
  /CONSTRAINT\s+uq_vehicle_capabilities_vehicle_cap\s+UNIQUE\s*\(\s*vehicle_id\s*,\s*capability_id\s*\)/i.test(migrationSql),
  'vehicle_capabilities enforces unique constraint (vehicle_id, capability_id)',
  'Unique constraint on vehicle_capabilities missing'
);

assert(
  /ALTER\s+TABLE\s+public\.service_capabilities\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(migrationSql),
  'RLS enabled on service_capabilities',
  'RLS not enabled on service_capabilities'
);

assert(
  /ALTER\s+TABLE\s+public\.vehicle_capabilities\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(migrationSql),
  'RLS enabled on vehicle_capabilities',
  'RLS not enabled on vehicle_capabilities'
);

// ------------------------------------------------------------------------------
// 4. Role-Aware vehicle_capabilities SELECT RLS (Worker Confinement)
// ------------------------------------------------------------------------------
console.log('\n--- 4. Role-Aware vehicle_capabilities SELECT RLS ---');

const vcSelectPolicy = extractPolicy(migrationSql, 'vehicle_capabilities_select');

assert(vcSelectPolicy !== null, 'vehicle_capabilities_select policy extracted successfully', 'Policy not found');

if (vcSelectPolicy) {
  assert(
    /TO\s+authenticated/i.test(vcSelectPolicy),
    'vehicle_capabilities_select policy strictly restricted TO authenticated',
    'Policy not restricted to authenticated'
  );

  assert(
    /organization_id\s*=\s*public\.get_current_user_organization_id\(\)/i.test(vcSelectPolicy),
    'vehicle_capabilities_select requires organization_id = public.get_current_user_organization_id()',
    'Tenant organization check missing from SELECT policy'
  );

  assert(
    /public\.get_current_user_role\(\)\s+IN\s*\(\s*'admin'\s*,\s*'operator'\s*\)/i.test(vcSelectPolicy),
    'vehicle_capabilities_select grants organization-wide SELECT explicitly to admin and operator roles',
    'Admin/operator organization-wide SELECT branch missing'
  );

  // CRITICAL CHECK: Verify worker does NOT receive same-org organization-wide access
  // Worker must NOT have access merely by being in the organization
  const hasUnrestrictedWorkerSelect = /public\.get_current_user_role\(\)\s*=\s*'worker'\s*(?!\s*AND\s*EXISTS)/i.test(vcSelectPolicy);
  assert(
    !hasUnrestrictedWorkerSelect,
    'vehicle_capabilities_select prevents workers from organization-wide capability reads',
    'Worker role has unrestricted organization-wide read in SELECT policy'
  );

  assert(
    /public\.get_current_user_role\(\)\s*=\s*'worker'/i.test(vcSelectPolicy),
    'vehicle_capabilities_select explicitly inspects worker role',
    'Worker role branch missing'
  );

  assert(
    /EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.worker_vehicle_assignments\s+wva/i.test(vcSelectPolicy),
    'vehicle_capabilities_select worker path inspects worker_vehicle_assignments (wva)',
    'worker_vehicle_assignments subquery missing from worker path'
  );

  assert(
    /wva\.vehicle_id\s*=\s*public\.vehicle_capabilities\.vehicle_id/i.test(vcSelectPolicy),
    'vehicle_capabilities_select worker path binds assignment to exact vehicle_id',
    'Binding to exact vehicle_id missing'
  );

  assert(
    /wva\.worker_id\s*=\s*public\.get_current_worker_id\(\)/i.test(vcSelectPolicy),
    'vehicle_capabilities_select worker path binds assignment to current authenticated worker',
    'Binding to current authenticated worker missing'
  );

  assert(
    /wva\.organization_id\s*=\s*public\.get_current_user_organization_id\(\)/i.test(vcSelectPolicy),
    'vehicle_capabilities_select worker path binds assignment to caller organization',
    'Binding to caller organization missing'
  );

  assert(
    /wva\.status\s*=\s*'active'/i.test(vcSelectPolicy),
    'vehicle_capabilities_select worker path requires assignment status to be active',
    'Active status check missing'
  );
}

// ------------------------------------------------------------------------------
// 5. vehicle_capabilities Write Policies (INSERT / UPDATE / DELETE)
// ------------------------------------------------------------------------------
console.log('\n--- 5. vehicle_capabilities Write Policies ---');

const vcInsertPolicy = extractPolicy(migrationSql, 'vehicle_capabilities_insert');
assert(vcInsertPolicy !== null, 'vehicle_capabilities_insert policy extracted', 'INSERT policy missing');

if (vcInsertPolicy) {
  assert(
    /FOR\s+INSERT\s+TO\s+authenticated/i.test(vcInsertPolicy),
    'vehicle_capabilities_insert restricted TO authenticated',
    'Not restricted to authenticated'
  );
  assert(
    /WITH\s+CHECK\s*\([\s\S]*?organization_id\s*=\s*public\.get_current_user_organization_id\(\)[\s\S]*?public\.get_current_user_role\(\)\s+IN\s*\(\s*'admin'\s*,\s*'operator'\s*\)/i.test(vcInsertPolicy),
    'vehicle_capabilities_insert has WITH CHECK enforcing caller org and admin/operator role',
    'WITH CHECK missing org or role enforcement'
  );
}

const vcUpdatePolicy = extractPolicy(migrationSql, 'vehicle_capabilities_update');
assert(vcUpdatePolicy !== null, 'vehicle_capabilities_update policy extracted', 'UPDATE policy missing');

if (vcUpdatePolicy) {
  assert(
    /FOR\s+UPDATE\s+TO\s+authenticated/i.test(vcUpdatePolicy),
    'vehicle_capabilities_update restricted TO authenticated',
    'Not restricted to authenticated'
  );
  assert(
    /USING\s*\([\s\S]*?organization_id\s*=\s*public\.get_current_user_organization_id\(\)[\s\S]*?public\.get_current_user_role\(\)\s+IN\s*\(\s*'admin'\s*,\s*'operator'\s*\)/i.test(vcUpdatePolicy),
    'vehicle_capabilities_update has explicit USING enforcing caller org and admin/operator role',
    'USING missing org or role check'
  );
  assert(
    /WITH\s+CHECK\s*\([\s\S]*?organization_id\s*=\s*public\.get_current_user_organization_id\(\)[\s\S]*?public\.get_current_user_role\(\)\s+IN\s*\(\s*'admin'\s*,\s*'operator'\s*\)/i.test(vcUpdatePolicy),
    'vehicle_capabilities_update has explicit WITH CHECK enforcing caller org and admin/operator role',
    'WITH CHECK missing org or role check'
  );
}

const vcDeletePolicy = extractPolicy(migrationSql, 'vehicle_capabilities_delete');
assert(vcDeletePolicy !== null, 'vehicle_capabilities_delete policy extracted', 'DELETE policy missing');

if (vcDeletePolicy) {
  assert(
    /FOR\s+DELETE\s+TO\s+authenticated/i.test(vcDeletePolicy),
    'vehicle_capabilities_delete restricted TO authenticated',
    'Not restricted to authenticated'
  );
  assert(
    /USING\s*\([\s\S]*?organization_id\s*=\s*public\.get_current_user_organization_id\(\)[\s\S]*?public\.get_current_user_role\(\)\s+IN\s*\(\s*'admin'\s*,\s*'operator'\s*\)/i.test(vcDeletePolicy),
    'vehicle_capabilities_delete has USING enforcing caller org and admin/operator role',
    'DELETE missing org or role check'
  );
}

// ------------------------------------------------------------------------------
// 6. service_capabilities Catalogue RLS
// ------------------------------------------------------------------------------
console.log('\n--- 6. service_capabilities Catalogue RLS ---');

const scSelectPolicy = extractPolicy(migrationSql, 'service_capabilities_select_active');
assert(scSelectPolicy !== null, 'service_capabilities_select_active policy extracted', 'SELECT policy missing');
if (scSelectPolicy) {
  assert(
    /USING\s*\(\s*is_active\s*=\s*true\s*\)/i.test(scSelectPolicy),
    'service_capabilities_select_active restricts reads to active catalogue items',
    'is_active = true predicate missing'
  );
}

const scInsertPolicy = extractPolicy(migrationSql, 'service_capabilities_insert_admin');
assert(scInsertPolicy !== null, 'service_capabilities_insert_admin policy extracted', 'INSERT policy missing');
if (scInsertPolicy) {
  assert(
    /public\.get_current_user_role\(\)\s+IN\s*\(\s*'admin'\s*,\s*'operator'\s*\)/i.test(scInsertPolicy),
    'service_capabilities_insert_admin enforces admin/operator role',
    'Role check missing'
  );
}

const scUpdatePolicy = extractPolicy(migrationSql, 'service_capabilities_update_admin');
assert(scUpdatePolicy !== null, 'service_capabilities_update_admin policy extracted', 'UPDATE policy missing');
if (scUpdatePolicy) {
  assert(
    /USING[\s\S]*?public\.get_current_user_role\(\)\s+IN\s*\(\s*'admin'\s*,\s*'operator'\s*\)/i.test(scUpdatePolicy) &&
    /WITH\s+CHECK[\s\S]*?public\.get_current_user_role\(\)\s+IN\s*\(\s*'admin'\s*,\s*'operator'\s*\)/i.test(scUpdatePolicy),
    'service_capabilities_update_admin enforces admin/operator role in both USING and WITH CHECK',
    'Role check missing from USING or WITH CHECK'
  );
}

const scDeletePolicy = extractPolicy(migrationSql, 'service_capabilities_delete_admin');
assert(scDeletePolicy !== null, 'service_capabilities_delete_admin policy extracted', 'DELETE policy missing');

// ------------------------------------------------------------------------------
// 7. Spatial Function: get_nearby_vehicles Security & Validation
// ------------------------------------------------------------------------------
console.log('\n--- 7. Spatial Function: get_nearby_vehicles ---');

const getNearbyVehiclesFn = extractFunction(migrationSql, 'get_nearby_vehicles');
assert(getNearbyVehiclesFn !== null, 'get_nearby_vehicles function extracted', 'Function missing');

if (getNearbyVehiclesFn) {
  assert(
    /SECURITY\s+DEFINER/i.test(getNearbyVehiclesFn),
    'get_nearby_vehicles declared as SECURITY DEFINER',
    'SECURITY DEFINER missing'
  );

  assert(
    /SET\s+search_path\s*=\s*public\s*,\s*extensions/i.test(getNearbyVehiclesFn),
    'get_nearby_vehicles sets safe search_path = public, extensions',
    'Safe search_path missing'
  );

  assert(
    !/p_organization_id/i.test(getNearbyVehiclesFn),
    'get_nearby_vehicles has NO organization_id input parameter (session derived)',
    'organization_id parameter found in function signature'
  );

  assert(
    /v_caller_org\s*:=\s*public\.get_current_user_organization_id\(\)/i.test(getNearbyVehiclesFn),
    'get_nearby_vehicles derives caller organization strictly from authenticated session',
    'get_current_user_organization_id() call missing'
  );

  assert(
    /v_caller_role\s*NOT\s+IN\s*\(\s*'admin'\s*,\s*'operator'\s*\)/i.test(getNearbyVehiclesFn),
    'get_nearby_vehicles verifies caller role is admin or operator (workers rejected)',
    'Admin/operator role check missing'
  );

  assert(
    /IF\s+p_latitude\s+IS\s+NULL\s+THEN[\s\S]*?RAISE\s+EXCEPTION/i.test(getNearbyVehiclesFn),
    'get_nearby_vehicles rejects NULL latitude with exception',
    'NULL latitude check missing'
  );

  assert(
    /p_latitude\s*=\s*'NaN'::DOUBLE\s+PRECISION/i.test(getNearbyVehiclesFn) &&
    /p_latitude\s*=\s*'Infinity'::DOUBLE\s+PRECISION/i.test(getNearbyVehiclesFn) &&
    /p_latitude\s*=\s*'-Infinity'::DOUBLE\s+PRECISION/i.test(getNearbyVehiclesFn),
    'get_nearby_vehicles rejects NaN, +Infinity, and -Infinity for latitude',
    'Finite latitude checks missing'
  );

  assert(
    /p_latitude\s*<\s*-90(?:\.0)?\s+OR\s+p_latitude\s*>\s*90(?:\.0)?/i.test(getNearbyVehiclesFn),
    'get_nearby_vehicles enforces latitude bounds [-90, 90]',
    'Latitude bounds check missing'
  );

  assert(
    /IF\s+p_longitude\s+IS\s+NULL\s+THEN[\s\S]*?RAISE\s+EXCEPTION/i.test(getNearbyVehiclesFn),
    'get_nearby_vehicles rejects NULL longitude with exception',
    'NULL longitude check missing'
  );

  assert(
    /p_longitude\s*=\s*'NaN'::DOUBLE\s+PRECISION/i.test(getNearbyVehiclesFn) &&
    /p_longitude\s*=\s*'Infinity'::DOUBLE\s+PRECISION/i.test(getNearbyVehiclesFn) &&
    /p_longitude\s*=\s*'-Infinity'::DOUBLE\s+PRECISION/i.test(getNearbyVehiclesFn),
    'get_nearby_vehicles rejects NaN, +Infinity, and -Infinity for longitude',
    'Finite longitude checks missing'
  );

  assert(
    /p_longitude\s*<\s*-180(?:\.0)?\s+OR\s+p_longitude\s*>\s*180(?:\.0)?/i.test(getNearbyVehiclesFn),
    'get_nearby_vehicles enforces longitude bounds [-180, 180]',
    'Longitude bounds check missing'
  );

  assert(
    /IF\s+p_radius_meters\s+IS\s+NULL\s+THEN[\s\S]*?RAISE\s+EXCEPTION/i.test(getNearbyVehiclesFn),
    'get_nearby_vehicles rejects NULL radius with exception',
    'NULL radius check missing'
  );

  assert(
    /p_radius_meters\s*=\s*'NaN'::DOUBLE\s+PRECISION/i.test(getNearbyVehiclesFn) &&
    /p_radius_meters\s*=\s*'Infinity'::DOUBLE\s+PRECISION/i.test(getNearbyVehiclesFn) &&
    /p_radius_meters\s*=\s*'-Infinity'::DOUBLE\s+PRECISION/i.test(getNearbyVehiclesFn),
    'get_nearby_vehicles rejects NaN, +Infinity, and -Infinity for radius',
    'Finite radius checks missing'
  );

  assert(
    /p_radius_meters\s*<=\s*0(?:\.0)?/i.test(getNearbyVehiclesFn),
    'get_nearby_vehicles rejects radius <= 0 with exception',
    'Radius <= 0 check missing'
  );

  assert(
    /p_radius_meters\s*>\s*200000(?:\.0)?/i.test(getNearbyVehiclesFn),
    'get_nearby_vehicles rejects radius > 200,000m (200km) with exception (no silent clamping)',
    'Radius > 200000m check missing'
  );

  assert(
    /GREATEST\s*\(\s*1\s*,\s*LEAST\s*\(\s*COALESCE\s*\(\s*p_limit\s*,\s*20\s*\)\s*,\s*100\s*\)\s*\)/i.test(getNearbyVehiclesFn),
    'get_nearby_vehicles safely bounds result limit between 1 and 100',
    'Result limit bounding missing'
  );

  assert(
    /ST_DWithin\s*\(\s*v\.last_known_location\s*,\s*v_origin\s*,\s*p_radius_meters\s*\)/i.test(getNearbyVehiclesFn),
    'get_nearby_vehicles utilizes ST_DWithin for spatial filtering',
    'ST_DWithin filter missing'
  );

  assert(
    /ST_Distance\s*\(\s*v\.last_known_location\s*,\s*v_origin\s*\)/i.test(getNearbyVehiclesFn),
    'get_nearby_vehicles utilizes ST_Distance for distance calculation in metres',
    'ST_Distance missing'
  );

  assert(
    /v\.organization_id\s*=\s*v_caller_org/i.test(getNearbyVehiclesFn),
    'get_nearby_vehicles filters vehicles by caller organization_id',
    'Caller organization filter missing'
  );

  assert(
    /v\.is_active\s*=\s*true/i.test(getNearbyVehiclesFn),
    'get_nearby_vehicles filters to active vehicles only',
    'is_active filter missing'
  );

  assert(
    /vc\.organization_id\s*=\s*v_caller_org/i.test(getNearbyVehiclesFn),
    'get_nearby_vehicles capability subquery filters by caller organization_id',
    'Capability subquery organization filter missing'
  );
}

// ------------------------------------------------------------------------------
// 8. Spatial Function: get_nearby_vehicles_for_incident
// ------------------------------------------------------------------------------
console.log('\n--- 8. Spatial Function: get_nearby_vehicles_for_incident ---');

const getNearbyIncidentFn = extractFunction(migrationSql, 'get_nearby_vehicles_for_incident');
assert(getNearbyIncidentFn !== null, 'get_nearby_vehicles_for_incident function extracted', 'Function missing');

if (getNearbyIncidentFn) {
  assert(
    /SECURITY\s+DEFINER/i.test(getNearbyIncidentFn),
    'get_nearby_vehicles_for_incident declared as SECURITY DEFINER',
    'SECURITY DEFINER missing'
  );

  assert(
    /SET\s+search_path\s*=\s*public\s*,\s*extensions/i.test(getNearbyIncidentFn),
    'get_nearby_vehicles_for_incident sets safe search_path = public, extensions',
    'Safe search_path missing'
  );

  assert(
    /IF\s+p_incident_id\s+IS\s+NULL\s+THEN[\s\S]*?RAISE\s+EXCEPTION/i.test(getNearbyIncidentFn),
    'get_nearby_vehicles_for_incident rejects NULL incident ID with exception',
    'NULL incident check missing'
  );

  assert(
    /v_caller_role\s*NOT\s+IN\s*\(\s*'admin'\s*,\s*'operator'\s*\)/i.test(getNearbyIncidentFn),
    'get_nearby_vehicles_for_incident verifies caller role is admin or operator (workers rejected)',
    'Role verification missing'
  );

  assert(
    /p_radius_meters\s*<=\s*0(?:\.0)?/i.test(getNearbyIncidentFn) &&
    /p_radius_meters\s*>\s*200000(?:\.0)?/i.test(getNearbyIncidentFn),
    'get_nearby_vehicles_for_incident validates radius cannot bypass get_nearby_vehicles bounds',
    'Radius bypass prevention checks missing'
  );

  assert(
    /WHERE\s+id\s*=\s*p_incident_id\s+AND\s+organization_id\s*=\s*v_caller_org/i.test(getNearbyIncidentFn),
    'get_nearby_vehicles_for_incident constrains incident lookup to caller organization',
    'Incident organization lookup constraint missing'
  );

  assert(
    /public\.get_nearby_vehicles\s*\(\s*v_lat\s*,\s*v_lon\s*,\s*p_radius_meters\s*,\s*v_required_cap\s*,\s*p_limit\s*\)/i.test(getNearbyIncidentFn),
    'get_nearby_vehicles_for_incident safely delegates to get_nearby_vehicles',
    'Safe delegation call missing'
  );
}

// ------------------------------------------------------------------------------
// 9. Spatial Function: calculate_incident_vehicle_distance
// ------------------------------------------------------------------------------
console.log('\n--- 9. Spatial Function: calculate_incident_vehicle_distance ---');

const calcDistanceFn = extractFunction(migrationSql, 'calculate_incident_vehicle_distance');
assert(calcDistanceFn !== null, 'calculate_incident_vehicle_distance function extracted', 'Function missing');

if (calcDistanceFn) {
  assert(
    /SECURITY\s+DEFINER/i.test(calcDistanceFn),
    'calculate_incident_vehicle_distance declared as SECURITY DEFINER',
    'SECURITY DEFINER missing'
  );

  assert(
    /SET\s+search_path\s*=\s*public\s*,\s*extensions/i.test(calcDistanceFn),
    'calculate_incident_vehicle_distance sets safe search_path = public, extensions',
    'Safe search_path missing'
  );

  assert(
    /IF\s+p_incident_id\s+IS\s+NULL\s+OR\s+p_vehicle_id\s+IS\s+NULL\s+THEN[\s\S]*?RAISE\s+EXCEPTION/i.test(calcDistanceFn),
    'calculate_incident_vehicle_distance rejects NULL incident ID or NULL vehicle ID',
    'Null ID validation missing'
  );

  assert(
    /v_caller_org\s*:=\s*public\.get_current_user_organization_id\(\)/i.test(calcDistanceFn) &&
    /v_caller_role\s*:=\s*public\.get_current_user_role\(\)/i.test(calcDistanceFn),
    'calculate_incident_vehicle_distance derives organization and role from session',
    'Session derivation missing'
  );

  assert(
    /v_caller_role\s+IN\s*\(\s*'admin'\s*,\s*'operator'\s*\)/i.test(calcDistanceFn),
    'calculate_incident_vehicle_distance permits admin and operator for same organization',
    'Admin/operator permission branch missing'
  );

  assert(
    /v_caller_role\s*=\s*'worker'/i.test(calcDistanceFn),
    'calculate_incident_vehicle_distance defines explicit worker branch',
    'Worker branch missing'
  );

  assert(
    /SELECT\s+1\s+FROM\s+public\.assignments\s+a[\s\S]*?a\.incident_id\s*=\s*p_incident_id[\s\S]*?a\.worker_id\s*=\s*v_worker_id[\s\S]*?a\.organization_id\s*=\s*v_caller_org/i.test(calcDistanceFn),
    'calculate_incident_vehicle_distance worker path requires worker assigned to the incident',
    'Worker incident assignment check missing'
  );

  assert(
    /SELECT\s+1\s+FROM\s+public\.worker_vehicle_assignments\s+wva[\s\S]*?wva\.vehicle_id\s*=\s*p_vehicle_id[\s\S]*?wva\.worker_id\s*=\s*v_worker_id[\s\S]*?wva\.organization_id\s*=\s*v_caller_org[\s\S]*?wva\.status\s*=\s*'active'/i.test(calcDistanceFn),
    'calculate_incident_vehicle_distance worker path requires worker actively authorized for the vehicle',
    'Worker active vehicle assignment check missing'
  );

  assert(
    /WHERE\s+id\s*=\s*p_incident_id\s+AND\s+organization_id\s*=\s*v_caller_org/i.test(calcDistanceFn),
    'calculate_incident_vehicle_distance constrains incident to caller organization',
    'Caller organization constraint missing on incident'
  );

  assert(
    /WHERE\s+id\s*=\s*p_vehicle_id\s+AND\s+organization_id\s*=\s*v_caller_org/i.test(calcDistanceFn),
    'calculate_incident_vehicle_distance constrains vehicle to caller organization',
    'Caller organization constraint missing on vehicle'
  );

  assert(
    /ST_Distance\s*\(\s*v_incident_loc\s*,\s*v_vehicle_loc\s*\)/i.test(calcDistanceFn),
    'calculate_incident_vehicle_distance calculates PostGIS geography distance in metres',
    'ST_Distance missing'
  );
}

// ------------------------------------------------------------------------------
// 10. Privilege Revocations & Grants
// ------------------------------------------------------------------------------
console.log('\n--- 10. Function Privileges & Revocations ---');

assert(
  /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.calculate_incident_vehicle_distance\(UUID,\s*UUID\)\s+FROM\s+PUBLIC/i.test(migrationSql),
  'PUBLIC execution revoked from calculate_incident_vehicle_distance',
  'Revoke from PUBLIC missing'
);

assert(
  /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.calculate_incident_vehicle_distance\(UUID,\s*UUID\)\s+TO\s+authenticated/i.test(migrationSql),
  'EXECUTE granted to authenticated on calculate_incident_vehicle_distance',
  'Grant to authenticated missing'
);

assert(
  /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.get_nearby_vehicles\(DOUBLE\s+PRECISION,\s*DOUBLE\s+PRECISION,\s*DOUBLE\s+PRECISION,\s*UUID,\s*INTEGER\)\s+FROM\s+PUBLIC/i.test(migrationSql),
  'PUBLIC execution revoked from get_nearby_vehicles',
  'Revoke from PUBLIC missing'
);

assert(
  /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.get_nearby_vehicles\(DOUBLE\s+PRECISION,\s*DOUBLE\s+PRECISION,\s*DOUBLE\s+PRECISION,\s*UUID,\s*INTEGER\)\s+TO\s+authenticated/i.test(migrationSql),
  'EXECUTE granted to authenticated on get_nearby_vehicles',
  'Grant to authenticated missing'
);

assert(
  /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.get_nearby_vehicles_for_incident\(UUID,\s*DOUBLE\s+PRECISION,\s*INTEGER\)\s+FROM\s+PUBLIC/i.test(migrationSql),
  'PUBLIC execution revoked from get_nearby_vehicles_for_incident',
  'Revoke from PUBLIC missing'
);

assert(
  /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.get_nearby_vehicles_for_incident\(UUID,\s*DOUBLE\s+PRECISION,\s*INTEGER\)\s+TO\s+authenticated/i.test(migrationSql),
  'EXECUTE granted to authenticated on get_nearby_vehicles_for_incident',
  'Grant to authenticated missing'
);

// ------------------------------------------------------------------------------
// 11. Security Hygiene & Later Phase Boundary Guard
// ------------------------------------------------------------------------------
console.log('\n--- 11. Security Hygiene & Phase Boundaries ---');

assert(
  !migrationSql.includes('service_role') && !migrationSql.includes('secret_'),
  'Zero service role keys or secrets in migration',
  'Service role key or secret found'
);

assert(
  !/dispatch_score|recommendation_engine|auto_assign|assign_best_vehicle|mapbox_gl/i.test(migrationSql),
  'Phase 4-9 boundaries preserved (no auto-assignment, scoring, or mapping logic in Phase 3 migration)',
  'Later-phase dispatch engine keywords detected in Phase 3 migration'
);

// ------------------------------------------------------------------------------
// SUMMARY
// ------------------------------------------------------------------------------
console.log('\n================================================================');
console.log(`  PHASE 3 VERIFICATION RESULTS: ${passedChecks} / ${totalChecks} PASSED, ${failedChecks} FAILED`);
console.log('================================================================\n');

if (failedChecks > 0) {
  console.error(`ERROR: ${failedChecks} check(s) failed in Phase 3 spatial verification.`);
  process.exit(1);
} else {
  console.log('SUCCESS: All Phase 3 spatial, capability, and security checks passed cleanly.');
}
