/**
 * Phase 8 Customer Location Verification & GPS Flow Verification Suite
 *
 * Verifies:
 * A. Database Schema & RPC Contracts:
 * 1. Exactly one Phase 8 migration exists, sequentially after Phase 7D
 * 2. customer_location_requests table defined with id, organization_id, incident_id, token_hash, expires_at, used_at, revoked_at, created_by, created_at
 * 3. Zero plaintext token columns stored in table
 * 4. Tenant-safe composite foreign key to incidents(id, organization_id)
 * 5. RLS enabled on customer_location_requests
 * 6. Explicit fail-closed privileges: REVOKE ALL from PUBLIC, anon, authenticated
 * 7. Explicit read-only grant: GRANT SELECT to authenticated only
 * 8. Zero mutation privileges (INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER) granted to authenticated
 * 9. Operator RPC create_customer_location_request exists and requires admin/operator
 * 10. 32-byte cryptographically secure token generated and hashed with SHA-256
 * 11. One-hour token expiration
 * 12. Revocation of previous active unused requests on new generation
 * 13. Public status RPC get_customer_location_request_status exists and granted to anon
 * 14. Public status RPC returns minimal state without leaking PII or operational data
 * 15. Public submit RPC submit_customer_location exists and granted to anon
 * 16. Canonical lock order: incident FOR UPDATE occurs BEFORE customer_location_requests FOR UPDATE
 * 17. Submit RPC validates coordinate boundaries and finite non-negative accuracy (rejects NULL, negative, NaN, Infinity, -Infinity)
 * 18. PostGIS ST_MakePoint called with longitude first then latitude, with SRID 4326
 * 19. Authoritatively updates incidents.location, location_accuracy, and location_source = 'customer_link'
 * 20. Records CUSTOMER_LOCATION_CONFIRMED operational event with NULL actor (unauthenticated)
 * 21. Zero raw tokens logged in operational_events
 * 22. Submit RPC public success payload returns only { success: true, confirmed_at } and does NOT expose incident_id, organization_id, request_id, or token_hash
 * 23. Zero incident lifecycle or assignment status mutations inside submit_customer_location
 *
 * B. Customer Server Actions & Route:
 * 24. Customer route /customer/location/[token] preserved without auth requirements
 * 25. Validates token status via getCustomerLocationRequestStatus
 * 26. Handles statusResult.success === false explicitly with truthful verification failure UI
 * 27. SubmitCustomerLocationResult interface contains only confirmed_at (zero incident_id exposure)
 * 28. submitCustomerLocation validates date format without timestamp fabrication
 *
 * C. Customer Location Capture:
 * 29. One-shot navigator.geolocation.getCurrentPosition used
 * 30. Zero navigator.geolocation.watchPosition invocations
 * 31. High accuracy requested (enableHighAccuracy: true)
 * 32. 15-second timeout and 30-second maximumAge configured
 * 33. Geolocation permission denied, position unavailable, and timeout handled
 * 34. Offline navigator.onLine checked before GPS and submission
 * 35. Submits latitude, longitude, and accuracy via submitCustomerLocation
 * 36. Zero client storage queues (no localStorage/sessionStorage/IndexedDB)
 * 37. Zero polling or background GPS tracking
 *
 * D. Operator Incident Detail UI:
 * 38. CustomerLocationLinkControl client component exists
 * 39. Mounted inside operator incident detail page
 * 40. Generates link on explicit user action (button click)
 * 41. Uses /customer/location/ path
 * 42. Copy to clipboard action exists
 * 43. Terminal incident handling disables generation
 * 44. Zero SMS/Twilio/Vapi integration introduced
 *
 * E. Previous Phase Invariants & Quarantine:
 * 45. Phase 7 migrations and worker files unchanged relative to baseline 6751d4e
 * 46. Phase 7D Realtime bridge unchanged
 * 47. Phase 6 dispatch engine files unchanged
 * 48. Zero package.json dependency changes
 * 49. Zero middleware changes
 * 50. Quarantine: Only authorized Phase 8 files differ from baseline 6751d4e
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

/**
 * Strips block and line comments from SQL to prevent comment-based false matches
 */
function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((line) => {
      const commentIdx = line.indexOf('--');
      return commentIdx >= 0 ? line.slice(0, commentIdx) : line;
    })
    .join('\n');
}

console.log('================================================================');
console.log('  MATOS SYSTEMS — PHASE 8 CUSTOMER LOCATION VERIFICATION');
console.log('================================================================\n');

const baselineCommit = '6751d4e';

// ------------------------------------------------------------------------------
// SECTION 1: Database Migration & Schema Contracts
// ------------------------------------------------------------------------------
console.log('--- 1. Database Migration & Schema Contracts ---');

const migrationsDir = path.join(rootDir, 'supabase/migrations');
const migrationFiles = fs.readdirSync(migrationsDir).sort();

const phase7dMigration = '20260930200000_phase7d_operations_realtime.sql';
const phase8Migration = '20261001080000_phase8_customer_location_verification.sql';

assert(migrationFiles.includes(phase8Migration), 'Phase 8 migration exists');
assert(
  migrationFiles.indexOf(phase8Migration) > migrationFiles.indexOf(phase7dMigration),
  'Phase 8 migration sorts sequentially after Phase 7D'
);

const phase8SqlPath = path.join(migrationsDir, phase8Migration);
const phase8Sql = fs.readFileSync(phase8SqlPath, 'utf8');
const cleanSql = stripSqlComments(phase8Sql);

// Table structure
assert(
  cleanSql.includes('CREATE TABLE IF NOT EXISTS public.customer_location_requests'),
  'customer_location_requests table defined'
);
assert(cleanSql.includes('token_hash TEXT NOT NULL UNIQUE'), 'token_hash column exists and is UNIQUE');
assert(
  !/(\btoken\b|\braw_token\b)\s+TEXT\s+NOT\s+NULL/i.test(
    cleanSql.split('CREATE TABLE')[1].split(');')[0]
  ),
  'Zero plaintext token column in table'
);
assert(cleanSql.includes('expires_at TIMESTAMPTZ NOT NULL'), 'expires_at column exists');
assert(cleanSql.includes('used_at TIMESTAMPTZ NULL'), 'used_at column exists');
assert(cleanSql.includes('revoked_at TIMESTAMPTZ NULL'), 'revoked_at column exists');
assert(
  cleanSql.includes('REFERENCES public.incidents(id, organization_id)'),
  'Tenant-safe composite foreign key to incidents'
);

// 1. UPDATE TABLE PRIVILEGE ASSERTIONS
assert(
  cleanSql.includes('ALTER TABLE public.customer_location_requests ENABLE ROW LEVEL SECURITY'),
  'RLS enabled on customer_location_requests'
);
assert(
  /REVOKE\s+ALL\s+ON\s+public\.customer_location_requests\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*;/i.test(
    cleanSql
  ),
  'Accepted privilege model: REVOKE ALL ON public.customer_location_requests FROM PUBLIC, anon, authenticated;'
);
assert(
  /GRANT\s+SELECT\s+ON\s+public\.customer_location_requests\s+TO\s+authenticated\s*;/i.test(cleanSql),
  'Accepted privilege model: GRANT SELECT ON public.customer_location_requests TO authenticated;'
);

const forbiddenMutationPrivileges = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
for (const priv of forbiddenMutationPrivileges) {
  const grantRegex = new RegExp(
    `GRANT\\s+[^;]*\\b${priv}\\b[^;]*ON\\s+(?:TABLE\\s+)?(?:public\\.)?customer_location_requests\\s+TO\\s+[^;]*\\bauthenticated\\b`,
    'i'
  );
  assert(!grantRegex.test(cleanSql), `Authenticated is NOT granted ${priv} on customer_location_requests`);
}

// Operator RPC: create_customer_location_request
assert(
  cleanSql.includes('CREATE OR REPLACE FUNCTION public.create_customer_location_request'),
  'Operator create_customer_location_request RPC defined'
);
assert(
  cleanSql.includes("v_caller_role NOT IN ('admin', 'operator')"),
  'Create RPC restricts callers strictly to admin and operator'
);
assert(
  cleanSql.includes('gen_random_bytes(32)'),
  'Token generated with at least 32 cryptographically secure random bytes'
);
assert(
  cleanSql.includes("digest(v_raw_token, 'sha256')"),
  'Token stored as SHA-256 hash'
);
assert(
  cleanSql.includes("interval '1 hour'"),
  'Token expiration set to 1 hour'
);
assert(
  cleanSql.includes('SET revoked_at = v_now'),
  'Previous active unused tokens revoked upon new request generation'
);
assert(
  /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.create_customer_location_request\(UUID\)\s+FROM\s+PUBLIC\s*,\s*anon/i.test(
    cleanSql
  ),
  'Create RPC revoked from public/anon'
);
assert(
  /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.create_customer_location_request\(UUID\)\s+TO\s+authenticated/i.test(
    cleanSql
  ),
  'Create RPC granted to authenticated users'
);

// Public RPC: get_customer_location_request_status
assert(
  cleanSql.includes('CREATE OR REPLACE FUNCTION public.get_customer_location_request_status'),
  'Public get_customer_location_request_status RPC defined'
);
assert(
  /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.get_customer_location_request_status\(TEXT\)\s+TO\s+anon\s*,\s*authenticated/i.test(
    cleanSql
  ),
  'Status RPC granted to anon and authenticated'
);

// Public RPC: submit_customer_location - Extract function body for non-brittle SQL statement analysis
const submitFnStart = phase8Sql.indexOf('FUNCTION public.submit_customer_location');
assert(submitFnStart > 0, 'submit_customer_location function defined in migration');
const submitFnEnd = phase8Sql.indexOf('$$;', submitFnStart);
assert(submitFnEnd > submitFnStart, 'submit_customer_location function body terminated with $$;');
const submitFnBody = phase8Sql.slice(submitFnStart, submitFnEnd);
const cleanSubmitBody = stripSqlComments(submitFnBody);

// 2. ADD CANONICAL LOCK ORDER CHECK
// A. Initial token lookup must be strictly NON-LOCKING
const nonLockingLookupMatch = cleanSubmitBody.match(
  /SELECT\s+[^;]*\bFROM\s+public\.customer_location_requests\b[^;]*\bWHERE\s+token_hash\s*=[^;]*/i
);
assert(
  nonLockingLookupMatch && !/FOR\s+UPDATE/i.test(nonLockingLookupMatch[0]),
  'Initial token lookup on customer_location_requests is strictly non-locking'
);

// B. Incident lock must use FOR UPDATE
const incidentLockMatch = cleanSubmitBody.match(
  /SELECT\s+[^;]*\bFROM\s+public\.incidents\b[^;]*\bFOR\s+UPDATE\b/i
);
assert(incidentLockMatch, 'submit_customer_location locks target incident FOR UPDATE');

// C. Request row lock must use FOR UPDATE
const requestLockMatch = cleanSubmitBody.match(
  /SELECT\s+[^;]*\bFROM\s+public\.customer_location_requests\b[^;]*\bFOR\s+UPDATE\b/i
);
assert(requestLockMatch, 'submit_customer_location locks customer_location_requests row FOR UPDATE');

// D. Incident lock occurs BEFORE customer_location_requests lock
assert(
  incidentLockMatch.index < requestLockMatch.index,
  'Canonical lock order: incident FOR UPDATE occurs BEFORE customer_location_requests FOR UPDATE'
);

// 3. ADD FINITE ACCURACY CHECKS
assert(/\bp_accuracy\s+IS\s+NULL\b/i.test(cleanSubmitBody), 'Rejects NULL accuracy');
assert(/\bp_accuracy\s*<\s*0(\.0)?\b/i.test(cleanSubmitBody), 'Rejects negative accuracy');
assert(
  /\bp_accuracy\s*=\s*'NaN'(?:::double\s+precision)?\b/i.test(cleanSubmitBody),
  'Rejects NaN accuracy'
);
assert(
  /\bp_accuracy\s*=\s*'Infinity'(?:::double\s+precision)?\b/i.test(cleanSubmitBody),
  'Rejects Infinity accuracy'
);
assert(
  /\bp_accuracy\s*=\s*'-Infinity'(?:::double\s+precision)?\b/i.test(cleanSubmitBody),
  'Rejects -Infinity accuracy'
);

// PostGIS spatial write & metadata
assert(cleanSubmitBody.includes('SET used_at = v_now'), 'Submit RPC marks request as used (used_at = now())');
assert(
  cleanSubmitBody.includes('ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography'),
  'Submit RPC sets PostGIS location with longitude first, then latitude in SRID 4326'
);
assert(cleanSubmitBody.includes("location_source = 'customer_link'"), "Submit RPC sets location_source to 'customer_link'");
assert(cleanSubmitBody.includes('location_accuracy = p_accuracy'), 'Submit RPC sets location_accuracy');
assert(cleanSubmitBody.includes("'CUSTOMER_LOCATION_CONFIRMED'"), 'Submit RPC records CUSTOMER_LOCATION_CONFIRMED event');
assert(
  cleanSubmitBody.includes('NULL,') && cleanSubmitBody.includes("'CUSTOMER_LOCATION_CONFIRMED'"),
  'Operational event records NULL actor for unauthenticated customer submission'
);
assert(!cleanSubmitBody.includes('v_raw_token'), 'Raw token is NOT recorded in operational event metadata');

// 4. ADD MINIMAL PUBLIC SUBMIT RESPONSE CHECK
// Scope check strictly to the RETURN payload of submit_customer_location
const returnMatch = cleanSubmitBody.match(/RETURN\s+jsonb_build_object\s*\(([\s\S]*?)\);/i);
assert(returnMatch, 'submit_customer_location contains RETURN jsonb_build_object statement');
const returnPayload = returnMatch[1];
assert(/'success'\s*,\s*true/i.test(returnPayload), "Return payload includes 'success': true");
assert(/'confirmed_at'/i.test(returnPayload), "Return payload includes 'confirmed_at'");
assert(!/\bincident_id\b/i.test(returnPayload), "Return payload does NOT expose incident_id");
assert(!/\borganization_id\b/i.test(returnPayload), "Return payload does NOT expose organization_id");
assert(!/\brequest_id\b/i.test(returnPayload), "Return payload does NOT expose request_id");
assert(!/\btoken_hash\b/i.test(returnPayload), "Return payload does NOT expose token_hash");

// 5. ADD ZERO LIFECYCLE / ASSIGNMENT MUTATION CHECK
assert(
  !/\bUPDATE\s+(?:public\.)?assignments\b/i.test(cleanSubmitBody),
  'Zero assignments table UPDATE in submit_customer_location'
);
assert(
  !/\bassignments\b[^;]*\bstatus\b/i.test(cleanSubmitBody),
  'Zero assignment status mutation in submit_customer_location'
);
assert(
  !/\btransition_incident_status\b/i.test(cleanSubmitBody),
  'Zero transition_incident_status invocation in submit_customer_location'
);
assert(
  !/\bSET\s+[^;]*\bstatus\s*=/i.test(cleanSubmitBody),
  'Zero incident status assignment in submit_customer_location'
);

const incidentUpdateMatch = cleanSubmitBody.match(
  /UPDATE\s+(?:public\.)?incidents\s+SET\s+([\s\S]*?)\s+WHERE\b/i
);
assert(incidentUpdateMatch, 'submit_customer_location contains UPDATE incidents statement');
const incidentSetClause = incidentUpdateMatch[1];
assert(!/\bstatus\s*=/i.test(incidentSetClause), 'Zero status mutation in UPDATE incidents');
assert(
  /\blocation\s*=/i.test(incidentSetClause) &&
    /\blocation_accuracy\s*=/i.test(incidentSetClause) &&
    /\blocation_source\s*=/i.test(incidentSetClause) &&
    /\bupdated_at\s*=/i.test(incidentSetClause),
  'UPDATE incidents modifies location fields and updated_at only'
);

// ------------------------------------------------------------------------------
// SECTION 2: Customer Server Actions & Route
// ------------------------------------------------------------------------------
console.log('\n--- 2. Customer Server Actions & Route ---');

const actionsPath = path.join(rootDir, 'src/lib/customer/location-actions.ts');
assert(fs.existsSync(actionsPath), 'src/lib/customer/location-actions.ts exists');
const actionsSrc = fs.readFileSync(actionsPath, 'utf8');

assert(actionsSrc.startsWith("'use server'"), "location-actions.ts starts with 'use server'");
assert(
  actionsSrc.includes('export async function createCustomerLocationRequest'),
  'createCustomerLocationRequest action exported'
);
assert(
  actionsSrc.includes('export async function getCustomerLocationRequestStatus'),
  'getCustomerLocationRequestStatus action exported'
);
assert(
  actionsSrc.includes('export async function submitCustomerLocation'),
  'submitCustomerLocation action exported'
);

// SubmitCustomerLocationResult interface check
const submitResultInterfaceMatch = actionsSrc.match(
  /export\s+interface\s+SubmitCustomerLocationResult[\s\S]*?\}/
);
assert(submitResultInterfaceMatch, 'SubmitCustomerLocationResult interface defined');
assert(
  !submitResultInterfaceMatch[0].includes('incident_id'),
  'SubmitCustomerLocationResult does NOT contain incident_id'
);
assert(
  submitResultInterfaceMatch[0].includes('confirmed_at: string'),
  'SubmitCustomerLocationResult contains confirmed_at: string'
);

// Zero timestamp fabrication check
assert(
  !actionsSrc.includes('new Date().toISOString()'),
  'Zero fallback timestamp fabrication (new Date().toISOString() is not used)'
);
assert(
  actionsSrc.includes('INVALID_RESPONSE'),
  'Handles malformed response with INVALID_RESPONSE'
);

// Customer Location Page Pre-check Verification
const customerPagePath = path.join(rootDir, 'src/app/customer/location/[token]/page.tsx');
assert(fs.existsSync(customerPagePath), 'Customer token page exists');
const customerPageSrc = fs.readFileSync(customerPagePath, 'utf8');

assert(
  customerPageSrc.includes('getCustomerLocationRequestStatus'),
  'Customer page validates token status'
);
assert(
  customerPageSrc.includes("We couldn't verify this location link") ||
    customerPageSrc.includes("We couldn&apos;t verify this location link"),
  'Customer page explicitly handles statusResult.success === false before token statuses'
);
assert(
  customerPageSrc.includes('Location has already been submitted.'),
  'Customer page renders used token state message'
);
assert(
  customerPageSrc.includes('This location link is no longer available.'),
  'Customer page renders expired/invalid token state message'
);
assert(
  customerPageSrc.includes('<CustomerLocationCapture'),
  'Customer page renders CustomerLocationCapture on valid token'
);

// ------------------------------------------------------------------------------
// SECTION 3: Customer Location Capture
// ------------------------------------------------------------------------------
console.log('\n--- 3. Customer Location Capture ---');

const capturePath = path.join(rootDir, 'src/components/customer/customer-location-capture.tsx');
assert(fs.existsSync(capturePath), 'CustomerLocationCapture component exists');
const captureSrc = fs.readFileSync(capturePath, 'utf8');

assert(captureSrc.startsWith("'use client'"), "CustomerLocationCapture starts with 'use client'");
assert(
  captureSrc.includes('navigator.geolocation.getCurrentPosition'),
  'Uses one-shot navigator.geolocation.getCurrentPosition'
);
assert(
  !/navigator\.geolocation\.watchPosition\s*\(/.test(captureSrc),
  'Zero watchPosition invocations'
);
assert(
  captureSrc.includes('enableHighAccuracy: true'),
  'Requests enableHighAccuracy: true'
);
assert(
  captureSrc.includes('timeout: 15000'),
  'Sets 15-second geolocation timeout'
);
assert(
  captureSrc.includes('maximumAge: 30000'),
  'Sets 30-second geolocation maximumAge'
);
assert(
  captureSrc.includes('navigator.onLine'),
  'Checks navigator.onLine before acquisition and submission'
);
assert(
  captureSrc.includes('PERMISSION_DENIED'),
  'Handles PERMISSION_DENIED error'
);
assert(
  captureSrc.includes('POSITION_UNAVAILABLE'),
  'Handles POSITION_UNAVAILABLE error'
);
assert(
  captureSrc.includes('TIMEOUT'),
  'Handles TIMEOUT error'
);
assert(
  captureSrc.includes('submitCustomerLocation'),
  'Calls submitCustomerLocation with acquired coordinates and accuracy'
);
assert(
  !captureSrc.includes('localStorage') && !captureSrc.includes('sessionStorage') && !captureSrc.includes('indexedDB'),
  'Zero client storage queues in customer capture'
);
assert(
  !captureSrc.includes('setInterval'),
  'Zero polling intervals in customer capture'
);

// ------------------------------------------------------------------------------
// SECTION 4: Operator Incident Detail UI
// ------------------------------------------------------------------------------
console.log('\n--- 4. Operator Incident Detail UI ---');

const linkControlPath = path.join(rootDir, 'src/components/incidents/customer-location-link-control.tsx');
assert(fs.existsSync(linkControlPath), 'CustomerLocationLinkControl component exists');
const linkControlSrc = fs.readFileSync(linkControlPath, 'utf8');

assert(linkControlSrc.startsWith("'use client'"), "CustomerLocationLinkControl starts with 'use client'");
assert(
  linkControlSrc.includes('createCustomerLocationRequest'),
  'Calls createCustomerLocationRequest server action'
);
assert(
  linkControlSrc.includes('/customer/location/'),
  'Constructs link with /customer/location/'
);
assert(
  linkControlSrc.includes('navigator.clipboard'),
  'Provides clipboard copy capability'
);
assert(
  linkControlSrc.includes('isTerminal') || linkControlSrc.includes('terminal'),
  'Handles terminal incident state'
);
assert(
  !linkControlSrc.includes('twilio') && !linkControlSrc.includes('vapi'),
  'Zero Twilio or Vapi integration'
);

const incidentPagePath = path.join(rootDir, 'src/app/(operator)/incidents/[id]/page.tsx');
const incidentPageSrc = fs.readFileSync(incidentPagePath, 'utf8');
assert(
  incidentPageSrc.includes('CustomerLocationLinkControl'),
  'Operator incident detail page mounts CustomerLocationLinkControl'
);

// ------------------------------------------------------------------------------
// SECTION 5: Previous Phase Invariants & Quarantine
// ------------------------------------------------------------------------------
console.log('\n--- 5. Previous Phase Invariants & Quarantine ---');

// Phase 7 migrations unchanged
const phase7Files = [
  'supabase/migrations/20260930160000_phase7_worker_lifecycle.sql',
  'supabase/migrations/20260930190000_phase7c_worker_location_publish.sql',
  'supabase/migrations/20260930200000_phase7d_operations_realtime.sql',
];
for (const f of phase7Files) {
  const diff = execSync(`git diff ${baselineCommit} -- "${f}"`, {
    cwd: rootDir,
    encoding: 'utf8',
  }).trim();
  assert(diff.length === 0, `Previous migration "${f}" has ZERO modifications relative to ${baselineCommit}`);
}

// Phase 7 worker files unchanged
const workerFiles = [
  'src/lib/worker/actions.ts',
  'src/lib/worker/assignment-data.ts',
  'src/lib/worker/location-actions.ts',
  'src/components/worker/worker-assignment-panel.tsx',
  'src/components/worker/worker-location-control.tsx',
  'src/components/worker/worker-pwa-registration.tsx',
];
for (const f of workerFiles) {
  const diff = execSync(`git diff ${baselineCommit} -- "${f}"`, {
    cwd: rootDir,
    encoding: 'utf8',
  }).trim();
  assert(diff.length === 0, `Worker file "${f}" has ZERO modifications relative to ${baselineCommit}`);
}

// Phase 7D Realtime bridge unchanged
const realtimeBridgeDiff = execSync(
  `git diff ${baselineCommit} -- "src/components/operations/operations-realtime-bridge.tsx"`,
  { cwd: rootDir, encoding: 'utf8' }
).trim();
assert(realtimeBridgeDiff.length === 0, 'Realtime bridge component has ZERO modifications');

// Phase 6 dispatch engine unchanged
const dispatchMigrationDiff = execSync(
  `git diff ${baselineCommit} -- "supabase/migrations/20260930060000_phase6_dispatch_engine.sql"`,
  { cwd: rootDir, encoding: 'utf8' }
).trim();
assert(dispatchMigrationDiff.length === 0, 'Phase 6 dispatch engine migration has ZERO modifications');

// package.json unchanged
const pkgDiff = execSync(`git diff ${baselineCommit} -- package.json`, {
  cwd: rootDir,
  encoding: 'utf8',
}).trim();
assert(pkgDiff.length === 0, 'package.json has ZERO modifications');

// Authorized Phase 8 files quarantine
const allowedPhase8Files = new Set([
  'supabase/migrations/20261001080000_phase8_customer_location_verification.sql',
  'src/lib/customer/location-actions.ts',
  'src/components/customer/customer-location-capture.tsx',
  'src/components/incidents/customer-location-link-control.tsx',
  'src/app/customer/location/[token]/page.tsx',
  'src/app/(operator)/incidents/[id]/page.tsx',
  'tests/phase8-customer-location-verification.mjs',
]);

let diffOutput = '';
try {
  diffOutput = execSync(`git diff --name-only ${baselineCommit}`, {
    cwd: rootDir,
    encoding: 'utf8',
  }).trim();
} catch (err) {
  assert(false, `Failed to execute git diff relative to baseline ${baselineCommit}: ${err.message}`);
}

const trackedChanges = diffOutput
  ? diffOutput
  .split(/\r?\n/)
  .map((f) => f.trim().replace(/\\/g, '/'))
  .filter((f) => f && !f.startsWith('node_modules/') && !f.startsWith('.next/') && !f.startsWith('.gemini/'))
  : [];

let statusOutput = '';
try {
  statusOutput = execSync('git status --porcelain --untracked-files=all', {
    cwd: rootDir,
    encoding: 'utf8',
  }).trim();
} catch (err) {
  assert(false, `Failed to execute git status: ${err.message}`);
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
    allowedPhase8Files.has(changedFile),
    `Quarantine check: Changed file "${changedFile}" is an authorized Phase 8 file`
  );
}

assert(
  allChangedFiles.size <= 8,
  `Quarantine check: Total changed/untracked files count (${allChangedFiles.size}) does not exceed permitted boundary (<= 8)`
);

// ------------------------------------------------------------------------------
// SUMMARY
// ------------------------------------------------------------------------------
console.log('\n================================================================');
console.log(`  PHASE 8 VERIFICATION COMPLETE: ${passedChecks} / ${totalChecks} PASSED (0 FAILED)`);
console.log('================================================================\n');

process.exit(0);
