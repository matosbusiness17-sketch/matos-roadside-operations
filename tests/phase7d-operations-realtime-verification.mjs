/**
 * Phase 7D Supabase Realtime Operator Sync Verification Suite
 *
 * Verifies:
 * 1. Exactly one Phase 7D migration exists
 * 2. Migration follows Phase 7C sequentially
 * 3. Migration targets existing supabase_realtime publication
 * 4. Vehicles table included in publication
 * 5. Incidents table included in publication
 * 6. Assignments table included in publication
 * 7. Publication addition is idempotent (inspects pg_publication_tables)
 * 8. Zero RLS disabling, zero service-role logic, zero new application tables
 * 9. Realtime bridge exists and starts with 'use client'
 * 10. Bridge reuses existing browser Supabase client (@/lib/supabase/client)
 * 11. Exactly one named Supabase channel
 * 12. postgres_changes subscriptions exist for vehicles, incidents, and assignments
 * 13. Realtime payload (payload.new/old) is NOT used to mutate snapshot state
 * 14. Realtime triggers onInvalidate
 * 15. Invalidation is debounced using setTimeout and clearTimeout
 * 16. Zero setInterval polling loops in bridge
 * 17. Cleanup removes Supabase channel
 * 18. Cleanup clears pending debounce timer
 * 19. OperationsWorkspace imports OperationsRealtimeBridge
 * 20. Exactly one bridge rendered in workspace JSX
 * 21. Bridge delegates to existing handleRefresh
 * 22. Existing refreshSeqRef preserved
 * 23. Existing inFlightPromiseRef preserved
 * 24. Existing pendingQueuedRefreshRef preserved
 * 25. Existing while(true) serialized refresh queue preserved
 * 26. Existing refreshOperationsSnapshot pathway preserved
 * 27. No direct Supabase client import added to operations-workspace.tsx
 * 28. Phase 7C GPS files remain completely untouched
 * 29. Only the four authorized Phase 7D files differ from baseline commit 9edd586
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
console.log('  MATOS SYSTEMS — PHASE 7D REALTIME OPERATOR SYNC VERIFICATION');
console.log('================================================================\n');

// ------------------------------------------------------------------------------
// SECTION 1: Migration Ordering & Publication Idempotency
// ------------------------------------------------------------------------------
console.log('--- 1. Migration Ordering & Publication Idempotency ---');

const migrationsDir = path.join(rootDir, 'supabase/migrations');
const migrationFiles = fs.readdirSync(migrationsDir).sort();

const phase7cMigration = '20260930190000_phase7c_worker_location_publish.sql';
const phase7dMigration = '20260930200000_phase7d_operations_realtime.sql';

assert(migrationFiles.includes(phase7dMigration), 'Phase 7D migration exists');
assert(
  migrationFiles.indexOf(phase7dMigration) > migrationFiles.indexOf(phase7cMigration),
  'Phase 7D migration sorts sequentially after Phase 7C migration'
);

const phase7dFiles = migrationFiles.filter((f) => f.includes('phase7d'));
assert(phase7dFiles.length === 1, `Exactly one Phase 7D migration exists (found ${phase7dFiles.length})`);

const phase7dSqlPath = path.join(migrationsDir, phase7dMigration);
const phase7dSql = fs.readFileSync(phase7dSqlPath, 'utf8');

assert(
  phase7dSql.includes('supabase_realtime'),
  'Migration targets existing supabase_realtime publication'
);

assert(
  phase7dSql.includes("'vehicles'") || phase7dSql.includes('public.vehicles'),
  'Vehicles table included in publication target'
);
assert(
  phase7dSql.includes("'incidents'") || phase7dSql.includes('public.incidents'),
  'Incidents table included in publication target'
);
assert(
  phase7dSql.includes("'assignments'") || phase7dSql.includes('public.assignments'),
  'Assignments table included in publication target'
);

assert(
  phase7dSql.includes('pg_publication_tables'),
  'Inspects pg_publication_tables catalog for idempotent membership check'
);
assert(
  phase7dSql.includes('ALTER PUBLICATION supabase_realtime ADD TABLE'),
  'Adds tables via ALTER PUBLICATION supabase_realtime ADD TABLE'
);

// Safety & hygiene checks
assert(!/CREATE\s+TABLE/i.test(phase7dSql), 'Zero new application tables created');
assert(!/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(phase7dSql), 'Zero RLS disabling in migration');
assert(!phase7dSql.includes('service_role'), 'Zero service-role privilege escalation in migration');

// ------------------------------------------------------------------------------
// SECTION 2: Realtime Bridge Component Architecture
// ------------------------------------------------------------------------------
console.log('\n--- 2. Realtime Bridge Component Architecture ---');

const bridgePath = path.join(rootDir, 'src/components/operations/operations-realtime-bridge.tsx');
assert(fs.existsSync(bridgePath), 'src/components/operations/operations-realtime-bridge.tsx exists');
const bridgeSrc = fs.readFileSync(bridgePath, 'utf8');

assert(bridgeSrc.startsWith("'use client'"), "Bridge starts with 'use client'");
assert(
  bridgeSrc.includes("import { createClient } from '@/lib/supabase/client';"),
  'Bridge reuses existing browser Supabase client (@/lib/supabase/client)'
);

// Verify single named channel
const channelMatches = [...bridgeSrc.matchAll(/\.channel\(\s*['"]([^'"]+)['"]\s*\)/g)];
assert(channelMatches.length === 1, `Exactly one named Supabase channel created (found ${channelMatches.length})`);

// Verify postgres_changes subscriptions for all 3 tables
assert(
  bridgeSrc.includes("table: 'vehicles'") || bridgeSrc.includes('table: "vehicles"'),
  'Subscribes to postgres_changes for vehicles'
);
assert(
  bridgeSrc.includes("table: 'incidents'") || bridgeSrc.includes('table: "incidents"'),
  'Subscribes to postgres_changes for incidents'
);
assert(
  bridgeSrc.includes("table: 'assignments'") || bridgeSrc.includes('table: "assignments"'),
  'Subscribes to postgres_changes for assignments'
);

// Payload isolation: payload is an invalidation signal only, never authoritative state
assert(!bridgeSrc.includes('payload.new'), 'Bridge does NOT read payload.new (payload is invalidation signal only)');
assert(!bridgeSrc.includes('payload.old'), 'Bridge does NOT read payload.old');
assert(!bridgeSrc.includes('setSnapshot'), 'Bridge does NOT directly mutate workspace snapshot');

// Verify invalidation dispatch and debouncing
assert(bridgeSrc.includes('onInvalidate'), 'Bridge accepts and invokes onInvalidate callback');
assert(bridgeSrc.includes('setTimeout('), 'Bridge uses setTimeout for burst invalidation debouncing');
assert(bridgeSrc.includes('clearTimeout('), 'Bridge uses clearTimeout to coalesce rapid burst events');
assert(!bridgeSrc.includes('setInterval'), 'Zero setInterval polling loops in bridge');

// Verify cleanup
assert(
  bridgeSrc.includes('removeChannel('),
  'Cleanup function removes Realtime channel'
);
assert(
  bridgeSrc.includes('clearTimeout(debounceTimerRef.current)'),
  'Cleanup function clears pending debounce timer'
);

// ------------------------------------------------------------------------------
// SECTION 3: Operations Workspace Integration
// ------------------------------------------------------------------------------
console.log('\n--- 3. Operations Workspace Integration ---');

const workspacePath = path.join(rootDir, 'src/components/operations/operations-workspace.tsx');
assert(fs.existsSync(workspacePath), 'src/components/operations/operations-workspace.tsx exists');
const workspaceSrc = fs.readFileSync(workspacePath, 'utf8');

assert(
  workspaceSrc.includes("import { OperationsRealtimeBridge } from '@/components/operations/operations-realtime-bridge';"),
  'OperationsWorkspace imports OperationsRealtimeBridge'
);

// Verify exactly one bridge instance rendered
const bridgeInstances = [...workspaceSrc.matchAll(/<OperationsRealtimeBridge\s+/g)];
assert(bridgeInstances.length === 1, `Exactly one OperationsRealtimeBridge rendered in workspace (found ${bridgeInstances.length})`);

assert(
  workspaceSrc.includes('<OperationsRealtimeBridge onInvalidate={handleRefresh} />') ||
    workspaceSrc.includes('onInvalidate={handleRefresh}'),
  'OperationsRealtimeBridge delegates directly to existing handleRefresh'
);

// Architecture preservation: do NOT import Supabase directly into workspace
assert(
  !workspaceSrc.includes('@/lib/supabase/client') &&
    !workspaceSrc.includes('@/lib/supabase/server') &&
    !workspaceSrc.includes('@supabase/supabase-js'),
  'OperationsWorkspace does NOT import Supabase directly (isolated in bridge)'
);

// Existing refresh queue preservation
assert(workspaceSrc.includes('refreshSeqRef'), 'Preserves existing refreshSeqRef counter');
assert(workspaceSrc.includes('inFlightPromiseRef'), 'Preserves existing inFlightPromiseRef lock');
assert(workspaceSrc.includes('pendingQueuedRefreshRef'), 'Preserves existing pendingQueuedRefreshRef flag');
assert(workspaceSrc.includes('while (true)'), 'Preserves existing while (true) serialized refresh queue');
assert(workspaceSrc.includes('refreshOperationsSnapshot()'), 'Preserves authoritative refreshOperationsSnapshot loader');

// ------------------------------------------------------------------------------
// SECTION 4: Phase 7C Integrity & Working Tree Quarantine (relative to 9edd586)
// ------------------------------------------------------------------------------
console.log('\n--- 4. Phase 7C Integrity & Quarantine Relative to 9edd586 ---');

const baselineCommit = '9edd586';

// Verify Phase 7C files remain completely untouched
const phase7cFiles = [
  'supabase/migrations/20260930190000_phase7c_worker_location_publish.sql',
  'src/lib/worker/location-actions.ts',
  'src/components/worker/worker-location-control.tsx',
  'tests/phase7c-worker-location-verification.mjs',
];

for (const f of phase7cFiles) {
  const diff = execSync(`git diff ${baselineCommit} -- "${f}"`, {
    cwd: rootDir,
    encoding: 'utf8',
  }).trim();
  assert(diff.length === 0, `Phase 7C file "${f}" has ZERO modifications relative to ${baselineCommit}`);
}

// Quarantine check: only the 4 allowed Phase 7D files differ from 9edd586
const allowedPhase7DFiles = new Set([
  'supabase/migrations/20260930200000_phase7d_operations_realtime.sql',
  'src/components/operations/operations-realtime-bridge.tsx',
  'src/components/operations/operations-workspace.tsx',
  'tests/phase7d-operations-realtime-verification.mjs',
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
    allowedPhase7DFiles.has(changedFile),
    `Quarantine check: Changed file "${changedFile}" is an authorized Phase 7D file`
  );
}

assert(
  allChangedFiles.size <= 4,
  `Quarantine check: Total changed/untracked files count (${allChangedFiles.size}) does not exceed permitted 4 files`
);

// ------------------------------------------------------------------------------
// SUMMARY
// ------------------------------------------------------------------------------
console.log('\n================================================================');
console.log(`  PHASE 7D VERIFICATION COMPLETE: ${passedChecks} / ${totalChecks} PASSED (0 FAILED)`);
console.log('================================================================\n');

process.exit(0);
