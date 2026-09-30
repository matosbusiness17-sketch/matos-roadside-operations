/**
 * Phase 7C Worker GPS / Vehicle Location Publishing Verification Suite
 *
 * Verifies:
 * 1. Exactly one new Phase 7C migration exists, sequentially ordered
 * 2. RPC exists with exact parameters (p_latitude double precision, p_longitude double precision)
 * 3. SECURITY DEFINER + safe search_path = public, extensions
 * 4. Active authenticated profile check (v_profile_active), worker role check, and worker_profile existence
 * 5. Session-derived worker/org/vehicle identity (no client-supplied vehicle or org)
 * 6. Exactly one active worker_vehicle_assignment required (rejects 0 or >1 bindings)
 * 7. Active vehicle check (v_vehicle_active) and tenant scoping
 * 8. Coordinate validation in SQL [-90..90, -180..180]
 * 9. PostGIS write order: ST_MakePoint(p_longitude, p_latitude) with SRID 4326 geography
 * 10. Updates last_known_location and location_updated_at without duplicate columns
 * 11. RPC ACL revoked from PUBLIC/anon, granted to authenticated
 * 12. location-actions.ts is 'use server' and exports publishWorkerLocation
 * 13. Client cannot supply vehicle_id or organization_id to server action
 * 14. Server action validates coordinates and runtime RPC response
 * 15. worker-location-control.tsx is 'use client'
 * 16. Uses navigator.geolocation.getCurrentPosition
 * 17. Does NOT use watchPosition
 * 18. Zero intervals, polling, Realtime, service worker, or localStorage/sessionStorage
 * 19. Busy / duplicate-submission guard on button and handler
 * 20. Permission denied, unsupported, and error state handling with role="alert" / aria-live="polite"
 * 21. Worker panel renders location control strictly when assignment.vehicle_id !== null
 * 22. Worker panel does NOT pass vehicle_id to location control
 * 23. Existing five lifecycle mappings remain untouched
 * 24. Only the five allowed Phase 7C files differ from baseline commit af060e2
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

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
console.log('  MATOS SYSTEMS — PHASE 7C WORKER LOCATION VERIFICATION');
console.log('================================================================\n');

// ------------------------------------------------------------------------------
// SECTION 1: Migration Ordering & Schema Hygiene
// ------------------------------------------------------------------------------
console.log('--- 1. Migration Ordering & Schema Hygiene ---');

const migrationsDir = path.join(rootDir, 'supabase/migrations');
const migrationFiles = fs.readdirSync(migrationsDir).sort();

const phase7cMigration = '20260930190000_phase7c_worker_location_publish.sql';
const phase7aMigration = '20260930160000_phase7_worker_lifecycle.sql';

assert(migrationFiles.includes(phase7cMigration), 'Phase 7C migration exists');
assert(
  migrationFiles.indexOf(phase7cMigration) > migrationFiles.indexOf(phase7aMigration),
  'Phase 7C migration sorts sequentially after Phase 7A migration'
);

// Count Phase 7C migrations
const phase7cFiles = migrationFiles.filter((f) => f.includes('phase7c'));
assert(phase7cFiles.length === 1, `Exactly one Phase 7C migration exists (found ${phase7cFiles.length})`);

const phase7cSqlPath = path.join(migrationsDir, phase7cMigration);
const phase7cSql = fs.readFileSync(phase7cSqlPath, 'utf8');

// Ensure no duplicate latitude/longitude columns were added
assert(
  !/ALTER\s+TABLE\s+public\.vehicles\s+ADD\s+COLUMN\s+latitude/i.test(phase7cSql) &&
    !/ALTER\s+TABLE\s+public\.vehicles\s+ADD\s+COLUMN\s+longitude/i.test(phase7cSql),
  'Phase 7C reuses existing PostGIS last_known_location column without duplicate lat/lng columns'
);

// ------------------------------------------------------------------------------
// SECTION 2: RPC Signature & Security Configuration
// ------------------------------------------------------------------------------
console.log('\n--- 2. RPC Signature & Security Configuration ---');

assert(
  phase7cSql.includes('CREATE OR REPLACE FUNCTION public.worker_publish_vehicle_location'),
  'Declares public.worker_publish_vehicle_location function'
);

const signatureMatch = phase7cSql.match(
  /worker_publish_vehicle_location\s*\(\s*p_latitude\s+double\s+precision\s*,\s*p_longitude\s+double\s+precision\s*\)\s*RETURNS\s+JSONB/i
);
assert(signatureMatch !== null, 'RPC signature strictly accepts (p_latitude double precision, p_longitude double precision) RETURNS JSONB');

// Extract RPC body
const rpcBodyMatch = phase7cSql.match(
  /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.worker_publish_vehicle_location[\s\S]+?\$\$([\s\S]+?)\$\$;/i
);
assert(rpcBodyMatch !== null, 'Extracted worker_publish_vehicle_location function body');
const rpcBody = rpcBodyMatch[1];

assert(phase7cSql.includes('SECURITY DEFINER'), 'worker_publish_vehicle_location is SECURITY DEFINER');
assert(
  phase7cSql.includes('SET search_path = public, extensions'),
  'worker_publish_vehicle_location sets safe search_path = public, extensions'
);

// ------------------------------------------------------------------------------
// SECTION 3: Authorization & Session-Derived Identity
// ------------------------------------------------------------------------------
console.log('\n--- 3. Authorization & Session-Derived Identity ---');

assert(rpcBody.includes('auth.uid()'), 'Derives caller UID from auth.uid()');
assert(rpcBody.includes("v_caller_role != 'worker'") || rpcBody.includes("v_caller_role <> 'worker'"), 'Strictly rejects non-worker callers');
assert(rpcBody.includes('v_profile_active'), 'Validates authenticated profile is active via v_profile_active');
assert(rpcBody.includes('Worker profile not found for authenticated user'), 'Validates worker_profile exists for authenticated user');

// Confirm absence of incorrect worker_profile is_active reference
assert(!rpcBody.includes('v_worker_active'), 'Does NOT reference non-existent worker_profile is_active column');

// Rejection of client-supplied vehicle or org identity
assert(!phase7cSql.includes('p_vehicle_id'), 'RPC does NOT accept client-supplied p_vehicle_id');
assert(!phase7cSql.includes('p_organization_id'), 'RPC does NOT accept client-supplied p_organization_id');

// ------------------------------------------------------------------------------
// SECTION 4: Active Shift Binding & PostGIS Update
// ------------------------------------------------------------------------------
console.log('\n--- 4. Active Shift Binding & PostGIS Update ---');

assert(
  rpcBody.includes('public.worker_vehicle_assignments') && rpcBody.includes("status = 'active'"),
  'Queries worker_vehicle_assignments for active binding'
);
assert(rpcBody.includes('v_binding_count = 0'), 'Rejects worker without active vehicle binding');
assert(rpcBody.includes('v_binding_count > 1'), 'Rejects ambiguous multiple active vehicle bindings');

assert(rpcBody.includes('v_vehicle_active'), 'Validates assigned vehicle is active via v_vehicle_active');

assert(
  rpcBody.includes('p_latitude < -90.0') && rpcBody.includes('p_longitude < -180.0'),
  'Validates coordinate bounds in SQL'
);

assert(
  rpcBody.includes('ST_MakePoint(p_longitude, p_latitude)'),
  'PostGIS ST_MakePoint uses correct coordinate order: longitude then latitude'
);
assert(
  rpcBody.includes('ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography'),
  'Applies SRID 4326 and casts to geography'
);

assert(
  rpcBody.includes('last_known_location =') && rpcBody.includes('location_updated_at ='),
  'Updates last_known_location and location_updated_at on public.vehicles'
);

// ------------------------------------------------------------------------------
// SECTION 5: RPC ACL Privilege Management
// ------------------------------------------------------------------------------
console.log('\n--- 5. RPC ACL Privilege Management ---');

assert(
  /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.worker_publish_vehicle_location[\s\S]+?FROM\s+PUBLIC/i.test(phase7cSql),
  'Revokes execute from PUBLIC'
);
assert(
  /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.worker_publish_vehicle_location[\s\S]+?FROM\s+anon/i.test(phase7cSql),
  'Revokes execute from anon'
);
assert(
  /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.worker_publish_vehicle_location[\s\S]+?TO\s+authenticated/i.test(phase7cSql),
  'Grants execute strictly to authenticated'
);

// ------------------------------------------------------------------------------
// SECTION 6: Server Action (location-actions.ts)
// ------------------------------------------------------------------------------
console.log('\n--- 6. Server Action (src/lib/worker/location-actions.ts) ---');

const actionsPath = path.join(rootDir, 'src/lib/worker/location-actions.ts');
assert(fs.existsSync(actionsPath), 'src/lib/worker/location-actions.ts exists');
const actionsSrc = fs.readFileSync(actionsPath, 'utf8');

assert(actionsSrc.startsWith("'use server'"), "location-actions.ts starts with 'use server'");
assert(
  actionsSrc.includes('export async function publishWorkerLocation('),
  'Exports publishWorkerLocation async function'
);

// Check function signature
const fnSigMatch = actionsSrc.match(/publishWorkerLocation\s*\(\s*latitude\s*:\s*number\s*,\s*longitude\s*:\s*number\s*\)/);
assert(fnSigMatch !== null, 'publishWorkerLocation accepts strictly (latitude: number, longitude: number)');

assert(!actionsSrc.includes('vehicle_id: string,'), 'Server action does NOT accept vehicle_id from client');
assert(!actionsSrc.includes('organization_id: string,'), 'Server action does NOT accept organization_id from client');

assert(actionsSrc.includes('Number.isFinite(latitude)'), 'Validates latitude is finite');
assert(actionsSrc.includes('Number.isFinite(longitude)'), 'Validates longitude is finite');
assert(actionsSrc.includes('latitude < -90') && actionsSrc.includes('longitude < -180'), 'Validates coordinate ranges');

assert(
  actionsSrc.includes("supabase.rpc('worker_publish_vehicle_location'"),
  'Invokes worker_publish_vehicle_location RPC'
);

assert(actionsSrc.includes('UUID_REGEX.test(data.vehicle_id)'), 'Validates returned vehicle_id is a valid UUID');
assert(actionsSrc.includes('Date.parse(data.location_updated_at)'), 'Validates returned location_updated_at timestamp');

// ------------------------------------------------------------------------------
// SECTION 7: Client GPS Component (worker-location-control.tsx)
// ------------------------------------------------------------------------------
console.log('\n--- 7. Client GPS Component (src/components/worker/worker-location-control.tsx) ---');

const controlPath = path.join(rootDir, 'src/components/worker/worker-location-control.tsx');
assert(fs.existsSync(controlPath), 'src/components/worker/worker-location-control.tsx exists');
const controlSrc = fs.readFileSync(controlPath, 'utf8');

assert(controlSrc.startsWith("'use client'"), "worker-location-control.tsx starts with 'use client'");
assert(controlSrc.includes('navigator.geolocation.getCurrentPosition'), 'Uses navigator.geolocation.getCurrentPosition');
assert(
  !/navigator\.geolocation\.watchPosition\s*\(/.test(controlSrc),
  'Does NOT use navigator.geolocation.watchPosition (one-shot acquisition only)'
);

assert(!controlSrc.includes('setInterval'), 'Zero setInterval polling loops in location control');
assert(!controlSrc.includes('.channel('), 'Zero Realtime channel usage in location control');
assert(!controlSrc.includes('.subscribe('), 'Zero Realtime subscriptions in location control');
assert(!controlSrc.includes('serviceWorker'), 'Zero service worker usage in location control');
assert(!controlSrc.includes('localStorage'), 'Zero localStorage usage in location control');
assert(!controlSrc.includes('sessionStorage'), 'Zero sessionStorage usage in location control');

assert(controlSrc.includes('disabled={isBusy}'), 'Location button has disabled={isBusy} protection');
assert(controlSrc.includes('if (isBusy) return;'), 'Early guard prevents duplicate submission while busy');

assert(controlSrc.includes('Share current location'), 'Button text includes "Share current location"');
assert(controlSrc.includes('PERMISSION_DENIED'), 'Handles PERMISSION_DENIED geolocation error');
assert(controlSrc.includes('Location sharing is not supported by this browser.'), 'Handles unsupported browser state');

assert(controlSrc.includes('role="alert"'), 'Error banner uses role="alert"');
assert(controlSrc.includes('aria-live="polite"'), 'Pending/success banners use aria-live="polite"');

// ------------------------------------------------------------------------------
// SECTION 8: Worker Panel Integration
// ------------------------------------------------------------------------------
console.log('\n--- 8. Worker Panel Integration (src/components/worker/worker-assignment-panel.tsx) ---');

const panelPath = path.join(rootDir, 'src/components/worker/worker-assignment-panel.tsx');
const panelSrc = fs.readFileSync(panelPath, 'utf8');

assert(
  panelSrc.includes("import { WorkerLocationControl } from '@/components/worker/worker-location-control';"),
  'WorkerAssignmentPanel imports WorkerLocationControl'
);

assert(
  panelSrc.includes('assignment.vehicle_id !== null && (\n            <WorkerLocationControl />\n          )') ||
    panelSrc.includes('assignment.vehicle_id !== null && (\n            <WorkerLocationControl />'),
  'WorkerAssignmentPanel renders <WorkerLocationControl /> strictly when assignment.vehicle_id !== null'
);

// Ensure vehicle_id is NOT passed as a prop
assert(
  !/<WorkerLocationControl\s+[^>]*vehicle_id/i.test(panelSrc),
  'WorkerAssignmentPanel does NOT pass vehicle_id prop to WorkerLocationControl'
);

// Ensure WorkerLocationControl is NOT in the null assignment block
const nullBlockStart = panelSrc.indexOf('if (!assignment) {');
const activeBlockStart = panelSrc.indexOf('return (\n    <div className="space-y-4 max-w-full min-w-0">');
const nullBlockCode = panelSrc.slice(nullBlockStart, activeBlockStart);

assert(
  !nullBlockCode.includes('<WorkerLocationControl'),
  'WorkerLocationControl is NOT rendered when assignment is null'
);

// Verify all 5 lifecycle mappings remain intact in panel
const expectedMappings = [
  'assigned|dispatched',
  'accepted|dispatched',
  'en_route|en_route',
  'on_scene|on_scene',
  'on_scene|in_progress',
];
for (const pair of expectedMappings) {
  assert(panelSrc.includes(`case '${pair}':`), `Lifecycle mapping "${pair}" remains intact`);
}

// ------------------------------------------------------------------------------
// SECTION 9: Git Working Tree Quarantine (relative to af060e21)
// ------------------------------------------------------------------------------
console.log('\n--- 9. Working Tree Quarantine Relative to af060e2 ---');

const baselineCommit = 'af060e2';
const allowedPhase7CFiles = new Set([
  'supabase/migrations/20260930190000_phase7c_worker_location_publish.sql',
  'src/lib/worker/location-actions.ts',
  'src/components/worker/worker-location-control.tsx',
  'src/components/worker/worker-assignment-panel.tsx',
  'tests/phase7c-worker-location-verification.mjs',
]);

let diffOutput = '';
try {
  diffOutput = execSync(`git diff --name-only ${baselineCommit}`, {
    cwd: rootDir,
    encoding: 'utf8',
  }).trim();
} catch (err) {
  assert(false, `Failed to execute git diff relative to baseline commit ${baselineCommit}: ${err.message}`);
}

const trackedChanges = diffOutput
  ? diffOutput
      .split(/\r?\n/)
      .map((f) => f.trim().replace(/\\/g, '/'))
      .filter((f) => f && !f.startsWith('node_modules/') && !f.startsWith('.next/') && !f.startsWith('.gemini/'))
  : [];

let statusOutput = '';
try {
  statusOutput = execSync('git status --porcelain', {
    cwd: rootDir,
    encoding: 'utf8',
  }).trim();
} catch (err) {
  assert(false, `Failed to execute git status --porcelain: ${err.message}`);
}

const statusFiles = statusOutput
  ? statusOutput
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => line.slice(2).trim().replace(/^"|"$/g, '').replace(/\\/g, '/'))
      .filter((f) => f && !f.startsWith('node_modules/') && !f.startsWith('.next/') && !f.startsWith('.gemini/'))
  : [];

const allChangedFiles = new Set([...trackedChanges, ...statusFiles]);

for (const changedFile of allChangedFiles) {
  assert(
    allowedPhase7CFiles.has(changedFile),
    `Quarantine check: Changed file "${changedFile}" is an authorized Phase 7C file`
  );
}

assert(
  allChangedFiles.size <= 5,
  `Quarantine check: Total changed/untracked files count (${allChangedFiles.size}) does not exceed permitted 5 files`
);

// ------------------------------------------------------------------------------
// SUMMARY
// ------------------------------------------------------------------------------
console.log('\n================================================================');
console.log(`  PHASE 7C VERIFICATION COMPLETE: ${passedChecks} / ${totalChecks} PASSED (0 FAILED)`);
console.log('================================================================\n');

process.exit(0);
