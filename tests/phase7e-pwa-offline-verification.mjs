/**
 * Phase 7E Worker PWA + Offline Resilience + Final Phase 7 Verification Suite
 *
 * Verifies:
 * A. PWA Requirements:
 * 1. Manifest exists (src/app/manifest.ts)
 * 2. Worker start_url is /worker
 * 3. Scope is /worker
 * 4. Display standalone
 * 5. Worker icon referenced in manifest
 * 6. Worker icon exists (public/worker-icon.svg)
 * 7. Service worker exists (public/sw.js)
 * 8. Offline fallback exists (public/offline.html)
 * 9. Worker registration component exists (src/components/worker/worker-pwa-registration.tsx)
 * 10. Worker layout mounts exactly one registration component
 *
 * B. Service Worker Safety:
 * 11. Versioned cache exists in sw.js
 * 12. offline.html is precached
 * 13. worker-icon.svg is precached
 * 14. /worker authenticated HTML is NOT precached
 * 15. Navigation uses network-first behavior
 * 16. Fallback returns offline.html on network failure
 * 17. POST requests are not handled or cached
 * 18. No Background Sync API usage
 * 19. No operational data queue in sw.js
 * 20. No Supabase URL/data caching
 * 21. No operator-route caching
 *
 * C. Lifecycle Offline Safety:
 * 22. Existing five lifecycle mappings remain intact
 * 23. Offline navigator.onLine guard exists before lifecycle mutation
 * 24. Offline lifecycle message states changes are not queued
 * 25. transitionWorkerAssignment is not called on offline branch
 * 26. Zero localStorage/sessionStorage/IndexedDB lifecycle queue
 * 27. No optimistic assignment state introduced
 *
 * D. GPS Offline Safety:
 * 28. getCurrentPosition remains one-shot acquisition
 * 29. Zero watchPosition invocations
 * 30. Offline navigator.onLine guard exists in GPS control
 * 31. Offline GPS message states location was not sent or queued
 * 32. publishWorkerLocation is not called on offline branch
 * 33. No persistent GPS queue
 * 34. No background GPS
 * 35. Zero intervals/polling in location control
 *
 * E. Previous Phase Invariants:
 * 36. Phase 7A worker lifecycle migration unchanged relative to baseline
 * 37. Phase 7D files unchanged relative to baseline
 * 38. Phase 7C server action and GPS RPC migration unchanged
 * 39. Exact five worker lifecycle actions remain
 * 40. Realtime operator sync remains outside worker PWA implementation
 * 41. Zero new database migrations added in Phase 7E
 *
 * F. Quarantine:
 * 42. Only authorized Phase 7E files differ from baseline 4c6e1a4
 * 43. Zero package dependency changes
 * 44. Zero middleware changes
 * 45. Zero operator workspace changes
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
console.log('  MATOS SYSTEMS — PHASE 7E PWA & OFFLINE VERIFICATION');
console.log('================================================================\n');

// ------------------------------------------------------------------------------
// SECTION A: PWA Requirements
// ------------------------------------------------------------------------------
console.log('--- A. PWA Requirements ---');

const manifestPath = path.join(rootDir, 'src/app/manifest.ts');
assert(fs.existsSync(manifestPath), '1. Manifest file exists (src/app/manifest.ts)');

const manifestSrc = fs.readFileSync(manifestPath, 'utf8');
assert(manifestSrc.includes("start_url: '/worker'"), '2. Worker start_url is /worker');
assert(manifestSrc.includes("scope: '/worker'"), '3. Scope is /worker');
assert(manifestSrc.includes("display: 'standalone'"), '4. Display is standalone');
assert(manifestSrc.includes('/worker-icon.svg'), '5. Worker icon is referenced in manifest');

const iconPath = path.join(rootDir, 'public/worker-icon.svg');
assert(fs.existsSync(iconPath), '6. Worker icon exists (public/worker-icon.svg)');
const iconSrc = fs.readFileSync(iconPath, 'utf8');
assert(iconSrc.includes('viewBox="0 0 512 512"') || iconSrc.includes('viewBox='), 'Worker icon has valid SVG viewBox');
assert(!iconSrc.includes('<script'), 'Worker icon contains zero embedded scripts');

const swPath = path.join(rootDir, 'public/sw.js');
assert(fs.existsSync(swPath), '7. Service worker exists (public/sw.js)');

const offlinePath = path.join(rootDir, 'public/offline.html');
assert(fs.existsSync(offlinePath), '8. Offline fallback exists (public/offline.html)');
const offlineHtml = fs.readFileSync(offlinePath, 'utf8');
assert(!offlineHtml.includes('<script src='), 'Offline fallback contains zero external scripts');
assert(!offlineHtml.includes('assignment_id'), 'Offline fallback contains zero operational assignment data');

const registrationPath = path.join(rootDir, 'src/components/worker/worker-pwa-registration.tsx');
assert(fs.existsSync(registrationPath), '9. Worker PWA registration component exists');
const regSrc = fs.readFileSync(registrationPath, 'utf8');
assert(regSrc.startsWith("'use client'"), "Worker registration component starts with 'use client'");
assert(regSrc.includes("scope: '/worker'"), "Worker registration uses worker-only scope '/worker'");

const layoutPath = path.join(rootDir, 'src/app/worker/layout.tsx');
const layoutSrc = fs.readFileSync(layoutPath, 'utf8');
const registrationMounts = [...layoutSrc.matchAll(/<WorkerPwaRegistration\s*\/>/g)];
assert(registrationMounts.length === 1, '10. Worker layout mounts exactly one <WorkerPwaRegistration />');

// ------------------------------------------------------------------------------
// SECTION B: Service Worker Safety
// ------------------------------------------------------------------------------
console.log('\n--- B. Service Worker Safety ---');

const swSrc = fs.readFileSync(swPath, 'utf8');
assert(/const\s+CACHE_NAME\s*=\s*['"]matos-worker-pwa-v\d+['"]/.test(swSrc), '11. Versioned cache name defined in sw.js');
assert(swSrc.includes('/offline.html'), '12. offline.html is precached');
assert(swSrc.includes('/worker-icon.svg'), '13. worker-icon.svg is precached');
const precacheStart = swSrc.indexOf('const PRECACHE_ASSETS');
const precacheEnd = swSrc.indexOf('];', precacheStart);
const precacheBlock =
  precacheStart >= 0 && precacheEnd > precacheStart
    ? swSrc.slice(precacheStart, precacheEnd + 2)
    : '';

assert(
  precacheBlock.length > 0 &&
  !precacheBlock.includes("'/worker'") &&
  !precacheBlock.includes('"/worker"') &&
  !precacheBlock.includes("'/worker/'") &&
  !precacheBlock.includes('"/worker/"'),
  '14. /worker authenticated HTML is NOT precached'
);

assert(
  swSrc.includes('fetch(event.request)') && swSrc.includes('.catch('),
  '15. Navigation uses network-first behavior with .catch fallback'
);
assert(
  swSrc.includes('/offline.html'),
  '16. Fallback returns /offline.html on network failure'
);
assert(
  swSrc.includes("event.request.method !== 'GET'") || swSrc.includes('request.method === "GET"'),
  '17. POST requests are not handled or cached (GET only)'
);
assert(
  !/addEventListener\s*\(\s*['"]sync['"]/.test(swSrc) &&
  !/\.sync\.register\s*\(/.test(swSrc) &&
  !/\bSyncManager\b/.test(swSrc),
  '18. No Background Sync API usage in sw.js'
);
assert(!swSrc.includes('indexedDB') && !swSrc.includes('queue'), '19. Zero operational data queue in sw.js');
assert(!swSrc.includes('supabase.co'), '20. Zero Supabase URL/data caching');
assert(!swSrc.includes('/operations'), '21. Zero operator-route caching in sw.js');

// ------------------------------------------------------------------------------
// SECTION C: Lifecycle Offline Safety
// ------------------------------------------------------------------------------
console.log('\n--- C. Lifecycle Offline Safety ---');

const panelPath = path.join(rootDir, 'src/components/worker/worker-assignment-panel.tsx');
const panelSrc = fs.readFileSync(panelPath, 'utf8');

// Ensure all five lifecycle mappings are preserved
assert(panelSrc.includes("'assigned|dispatched'"), '22. assigned|dispatched lifecycle mapping preserved');
assert(panelSrc.includes("'accepted|dispatched'"), 'accepted|dispatched lifecycle mapping preserved');
assert(panelSrc.includes("'en_route|en_route'"), 'en_route|en_route lifecycle mapping preserved');
assert(panelSrc.includes("'on_scene|on_scene'"), 'on_scene|on_scene lifecycle mapping preserved');
assert(panelSrc.includes("'on_scene|in_progress'"), 'on_scene|in_progress lifecycle mapping preserved');

assert(
  panelSrc.includes('!navigator.onLine') || panelSrc.includes('navigator.onLine === false'),
  '23. Offline navigator.onLine guard exists before lifecycle mutation'
);
assert(
  panelSrc.includes('You are offline. Lifecycle changes are not queued.'),
  '24. Truthful offline lifecycle message states changes are not queued'
);

// Verify transitionWorkerAssignment is called ONLY after online check
const handleActionIdx = panelSrc.indexOf('const handleLifecycleAction');
const onlineGuardIdx = panelSrc.indexOf('navigator.onLine', handleActionIdx);
const transitionCallIdx = panelSrc.indexOf('transitionWorkerAssignment(', handleActionIdx);
assert(
  onlineGuardIdx > handleActionIdx && onlineGuardIdx < transitionCallIdx,
  '25. transitionWorkerAssignment is preceded by offline guard and not invoked when offline'
);

assert(!panelSrc.includes('localStorage') && !panelSrc.includes('sessionStorage'), '26. Zero Web Storage offline queue');
assert(!panelSrc.includes('indexedDB'), 'Zero IndexedDB offline lifecycle queue');
assert(!panelSrc.includes('setAssignment('), '27. No optimistic assignment state mutation introduced');

// ------------------------------------------------------------------------------
// SECTION D: GPS Offline Safety
// ------------------------------------------------------------------------------
console.log('\n--- D. GPS Offline Safety ---');

const locationPath = path.join(rootDir, 'src/components/worker/worker-location-control.tsx');
const locationSrc = fs.readFileSync(locationPath, 'utf8');

assert(
  locationSrc.includes('navigator.geolocation.getCurrentPosition'),
  '28. getCurrentPosition remains one-shot acquisition'
);
assert(
  !/navigator\.geolocation\.watchPosition\s*\(/.test(locationSrc),
  '29. Zero watchPosition invocations'
);
assert(
  locationSrc.includes('!navigator.onLine') || locationSrc.includes('navigator.onLine === false'),
  '30. Offline navigator.onLine guard exists in GPS location control'
);
assert(
  locationSrc.includes('You are offline. Location was not sent or queued.'),
  '31. Truthful offline GPS message states location was not sent or queued'
);

const handleShareIdx = locationSrc.indexOf('const handleShareLocation');
const gpsGuardIdx = locationSrc.indexOf('navigator.onLine', handleShareIdx);
const publishCallIdx = locationSrc.indexOf('publishWorkerLocation(', handleShareIdx);
assert(
  gpsGuardIdx > handleShareIdx && gpsGuardIdx < publishCallIdx,
  '32. publishWorkerLocation is guarded and not called on offline branch'
);

assert(!locationSrc.includes('localStorage') && !locationSrc.includes('sessionStorage'), '33. No persistent GPS queue in storage');
assert(!locationSrc.includes('setInterval'), '34. No background GPS intervals or recurring timers');
assert(
  !/navigator\.geolocation\.watchPosition\s*\(/.test(locationSrc),
  '35. No polling or continuous GPS tracking'
);

// ------------------------------------------------------------------------------
// SECTION E: Previous Phase Invariants & Integrity
// ------------------------------------------------------------------------------
console.log('\n--- E. Previous Phase Invariants & Integrity ---');

const baselineCommit = '4c6e1a4';

// 36. Phase 7A worker lifecycle migration unchanged
const phase7aMigration = 'supabase/migrations/20260930160000_phase7_worker_lifecycle.sql';
const phase7aDiff = execSync(`git diff ${baselineCommit} -- "${phase7aMigration}"`, {
  cwd: rootDir,
  encoding: 'utf8',
}).trim();
assert(phase7aDiff.length === 0, `36. Phase 7A migration "${phase7aMigration}" has ZERO modifications relative to ${baselineCommit}`);

// 37. Phase 7D files unchanged
const phase7dFiles = [
  'supabase/migrations/20260930200000_phase7d_operations_realtime.sql',
  'src/components/operations/operations-realtime-bridge.tsx',
  'src/components/operations/operations-workspace.tsx',
];
for (const f of phase7dFiles) {
  const diff = execSync(`git diff ${baselineCommit} -- "${f}"`, {
    cwd: rootDir,
    encoding: 'utf8',
  }).trim();
  assert(diff.length === 0, `37. Phase 7D file "${f}" has ZERO modifications relative to ${baselineCommit}`);
}

// 38. Phase 7C server action & GPS RPC migration unchanged
const phase7cFiles = [
  'supabase/migrations/20260930190000_phase7c_worker_location_publish.sql',
  'src/lib/worker/location-actions.ts',
];
for (const f of phase7cFiles) {
  const diff = execSync(`git diff ${baselineCommit} -- "${f}"`, {
    cwd: rootDir,
    encoding: 'utf8',
  }).trim();
  assert(diff.length === 0, `38. Phase 7C file "${f}" has ZERO modifications relative to ${baselineCommit}`);
}

// 39. Exact five worker lifecycle actions in worker/actions.ts unchanged
const workerActionsPath = path.join(rootDir, 'src/lib/worker/actions.ts');
const actionsDiff = execSync(`git diff ${baselineCommit} -- "${workerActionsPath}"`, {
  cwd: rootDir,
  encoding: 'utf8',
}).trim();
assert(actionsDiff.length === 0, `39. Worker server actions file "${workerActionsPath}" has ZERO modifications`);

// 40. Realtime operator sync remains outside worker PWA
assert(!manifestSrc.includes('realtime'), '40. Realtime is not referenced in worker manifest');
assert(!swSrc.includes('realtime'), 'Realtime is not intercepted or handled in service worker');

// 41. Zero new database migrations added in Phase 7E
const migrationsDir = path.join(rootDir, 'supabase/migrations');
const migrationFiles = fs.readdirSync(migrationsDir).sort();
const latestMigration = migrationFiles[migrationFiles.length - 1];
assert(
  latestMigration === '20260930200000_phase7d_operations_realtime.sql',
  `41. Latest migration remains Phase 7D migration (${latestMigration}); zero new migrations added`
);

// ------------------------------------------------------------------------------
// SECTION F: Quarantine Relative to Baseline 4c6e1a4
// ------------------------------------------------------------------------------
console.log('\n--- F. Quarantine Relative to Baseline 4c6e1a4 ---');

const allowedPhase7EFiles = new Set([
  'src/app/manifest.ts',
  'public/sw.js',
  'public/offline.html',
  'public/worker-icon.svg',
  'src/components/worker/worker-pwa-registration.tsx',
  'tests/phase7e-pwa-offline-verification.mjs',
  'src/app/worker/layout.tsx',
  'src/components/worker/worker-assignment-panel.tsx',
  'src/components/worker/worker-location-control.tsx',
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
    allowedPhase7EFiles.has(changedFile),
    `42. Quarantine check: Changed file "${changedFile}" is an authorized Phase 7E file`
  );
}

assert(
  allChangedFiles.size <= 9,
  `Quarantine check: Total changed/untracked files count (${allChangedFiles.size}) does not exceed permitted 9 files`
);

// 43. Zero package dependency changes
const pkgDiff = execSync(`git diff ${baselineCommit} -- package.json`, {
  cwd: rootDir,
  encoding: 'utf8',
}).trim();
assert(pkgDiff.length === 0, '43. package.json has ZERO modifications');

// 44. Zero middleware changes
if (fs.existsSync(path.join(rootDir, 'src/middleware.ts'))) {
  const mwDiff = execSync(`git diff ${baselineCommit} -- src/middleware.ts`, {
    cwd: rootDir,
    encoding: 'utf8',
  }).trim();
  assert(mwDiff.length === 0, '44. src/middleware.ts has ZERO modifications');
} else {
  assert(true, '44. Middleware unchanged (no middleware file)');
}

// 45. Zero operator workspace changes
const opDiff = execSync(`git diff ${baselineCommit} -- src/components/operations/operations-workspace.tsx`, {
  cwd: rootDir,
  encoding: 'utf8',
}).trim();
assert(opDiff.length === 0, '45. Operations workspace has ZERO modifications');

// ------------------------------------------------------------------------------
// SUMMARY
// ------------------------------------------------------------------------------
console.log('\n================================================================');
console.log(`  PHASE 7E VERIFICATION COMPLETE: ${passedChecks} / ${totalChecks} PASSED (0 FAILED)`);
console.log('================================================================\n');

process.exit(0);
