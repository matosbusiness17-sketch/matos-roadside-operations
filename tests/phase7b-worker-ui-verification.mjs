/**
 * Phase 7B Worker Mobile Assignment UI Verification Suite
 *
 * Comprehensive static and architectural verification for Phase 7B:
 * 1. File quarantine enforcement via git status & git diff relative to commit baa2853
 * 2. Frozen Phase 7A files zero-modification verification
 * 3. Client / Server boundary complete check for WorkerAssignmentPanel
 * 4. Exact 5 lifecycle mappings, button labels, and success messages
 * 5. Authoritative Server Action invocation and error handling
 * 6. Elimination of optimistic lifecycle state
 * 7. Double submission protection & complete isBusy contract
 * 8. Authoritative success refresh transition ordering
 * 9. Comprehensive stale-state refresh handling (all 3 codes)
 * 10. Manual refresh contract (error reset, success persistence)
 * 11. COMPLETE_JOB success persistence architecture & unconditional panel mounting
 * 12. Null state truthfulness & elimination of false "Idle" availability claim
 * 13. Nullable operational data handling & direct tel: link integrity (no location_description)
 * 14. Accessibility compliance (type="button", role="alert", aria-live="polite", min-h-[44px])
 * 15. Mobile page & panel hardening (~320px screen width)
 * 16. Badge variant verification against authoritative Badge component API
 * 17. Full phase boundary quarantine (zero GPS, Realtime, polling, service workers, telephony)
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
console.log('  MATOS SYSTEMS — PHASE 7B WORKER MOBILE UI VERIFICATION');
console.log('================================================================\n');

// ------------------------------------------------------------------------------
// SECTION 1: File Quarantine & Frozen File Integrity (relative to baa2853)
// ------------------------------------------------------------------------------
console.log('--- 1. Working Tree Quarantine & Frozen File Integrity ---');

const baselineCommit = 'baa2853';
const allowedPhase7BFiles = new Set([
  'src/app/worker/page.tsx',
  'src/components/worker/worker-assignment-panel.tsx',
  'tests/phase7b-worker-ui-verification.mjs',
]);

// Tracked modifications relative to baa2853
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

// Untracked or staged/unstaged porcelain status
let statusOutput = '';
try {
  statusOutput = execSync('git status --porcelain', {
    cwd: rootDir,
    encoding: 'utf8',
  }).trim();
} catch (err) {
  assert(false, `Failed to execute git status --porcelain: ${err.message}`);
}

const statusLines = statusOutput
  ? statusOutput
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  : [];

const statusFiles = statusLines
  .map((line) => {
    const filePath = line.slice(2).trim().replace(/^"|"$/g, '').replace(/\\/g, '/');
    return filePath;
  })
  .filter((f) => f && !f.startsWith('node_modules/') && !f.startsWith('.next/') && !f.startsWith('.gemini/'));

const allChangedFiles = new Set([...trackedChanges, ...statusFiles]);

for (const changedFile of allChangedFiles) {
  assert(
    allowedPhase7BFiles.has(changedFile),
    `Quarantine check: Changed file "${changedFile}" is an authorized Phase 7B file`
  );
}

assert(
  allChangedFiles.size <= 3,
  `Quarantine check: Total changed/untracked files count (${allChangedFiles.size}) does not exceed permitted 3 files`
);

// Explicitly verify frozen Phase 7A files have zero diff relative to baa2853
const frozenPhase7AFiles = [
  'supabase/migrations/20260930160000_phase7_worker_lifecycle.sql',
  'src/lib/worker/assignment-data.ts',
  'src/lib/worker/actions.ts',
  'src/types/index.ts',
  'tests/phase7-worker-lifecycle-verification.mjs',
];

for (const frozenFile of frozenPhase7AFiles) {
  const fileDiff = execSync(`git diff ${baselineCommit} -- "${frozenFile}"`, {
    cwd: rootDir,
    encoding: 'utf8',
  }).trim();
  assert(
    fileDiff.length === 0,
    `Frozen Phase 7A file "${frozenFile}" has ZERO modifications relative to ${baselineCommit}`
  );
}

// ------------------------------------------------------------------------------
// SECTION 2: Client / Server Boundary Complete Check
// ------------------------------------------------------------------------------
console.log('\n--- 2. Client / Server Boundary Complete Check ---');

const panelPath = path.join(rootDir, 'src/components/worker/worker-assignment-panel.tsx');
assert(fs.existsSync(panelPath), 'src/components/worker/worker-assignment-panel.tsx exists');
const panelSrc = fs.readFileSync(panelPath, 'utf8');

const workerPagePath = path.join(rootDir, 'src/app/worker/page.tsx');
assert(fs.existsSync(workerPagePath), 'src/app/worker/page.tsx exists');
const workerPageSrc = fs.readFileSync(workerPagePath, 'utf8');

// WorkerAssignmentPanel requirements
assert(panelSrc.startsWith("'use client'"), 'WorkerAssignmentPanel begins with "use client" directive');
assert(
  !/import\s+\*\s+as\s+React\s+from\s+['"]react['"]/i.test(panelSrc),
  'WorkerAssignmentPanel does NOT include unused "import * as React from \'react\'"'
);
assert(
  panelSrc.includes("import { transitionWorkerAssignment } from '@/lib/worker/actions'"),
  'WorkerAssignmentPanel imports transitionWorkerAssignment server action'
);

// Explicit forbidden server/database imports in client panel
const forbiddenClientSymbols = [
  'createClient',
  '@/lib/supabase/server',
  '@/lib/supabase/client',
  'getCurrentWorkerAssignment',
  'getCurrentUser',
  '.from(',
  '.rpc(',
];

for (const symbol of forbiddenClientSymbols) {
  assert(
    !panelSrc.includes(symbol),
    `WorkerAssignmentPanel does NOT import or call server-side/database symbol: "${symbol}"`
  );
}

// ------------------------------------------------------------------------------
// SECTION 3: Exact Five Mappings, Button Labels, and Success Messages
// ------------------------------------------------------------------------------
console.log('\n--- 3. Exact 5 Mappings, Button Labels, and Success Messages ---');

// Extract getLifecycleActionConfig function body
const fnMatch = panelSrc.match(/export\s+function\s+getLifecycleActionConfig\s*\([\s\S]+?\)\s*:\s*LifecycleActionConfig\s*\|\s*null\s*\{([\s\S]+?)\n\}/);
assert(fnMatch !== null, 'Extracted getLifecycleActionConfig function definition');
const fnBody = fnMatch[1];

assert(
  fnBody.includes('`${assignmentStatus}|${incidentStatus}`'),
  'getLifecycleActionConfig constructs composite pair from assignmentStatus and incidentStatus'
);

// Extract all switch cases
const caseMatches = [...fnBody.matchAll(/case\s+['"]([^'"]+)['"]\s*:/g)];
assert(caseMatches.length === 5, `Lifecycle matrix contains exactly 5 cases (found ${caseMatches.length})`);

const expectedMatrix = {
  'assigned|dispatched': {
    action: 'ACCEPT_ASSIGNMENT',
    buttonLabel: 'Accept assignment',
    successMessage: 'Assignment accepted.',
  },
  'accepted|dispatched': {
    action: 'START_JOURNEY',
    buttonLabel: 'Start journey',
    successMessage: 'Journey started.',
  },
  'en_route|en_route': {
    action: 'ARRIVE_ON_SCENE',
    buttonLabel: 'Arrived on scene',
    successMessage: 'Arrival confirmed.',
  },
  'on_scene|on_scene': {
    action: 'START_WORK',
    buttonLabel: 'Start work',
    successMessage: 'Work started.',
  },
  'on_scene|in_progress': {
    action: 'COMPLETE_JOB',
    buttonLabel: 'Complete job',
    successMessage: 'Job completed.',
  },
};

for (const [pair, expected] of Object.entries(expectedMatrix)) {
  const caseRegex = new RegExp(`case\\s+['"]${pair.replace('|', '\\|')}['"]\\s*:\\s*return\\s*\\{([\\s\\S]+?)\\};`);
  const match = fnBody.match(caseRegex);
  assert(match !== null, `Lifecycle matrix contains exact case for "${pair}"`);
  const block = match[1];

  assert(
    block.includes(`action: '${expected.action}'`),
    `Pair "${pair}" maps to exact action "${expected.action}"`
  );
  assert(
    block.includes(`buttonLabel: '${expected.buttonLabel}'`),
    `Pair "${pair}" maps to exact buttonLabel "${expected.buttonLabel}"`
  );
  assert(
    block.includes(`successMessage: '${expected.successMessage}'`),
    `Pair "${pair}" maps to exact successMessage "${expected.successMessage}"`
  );
}

// Default branch returns null
assert(
  /default\s*:\s*return\s+null\s*;/i.test(fnBody),
  'Lifecycle matrix default branch returns null (defense in depth)'
);

// ------------------------------------------------------------------------------
// SECTION 4: Authoritative Server Action Invocation & Error Handling
// ------------------------------------------------------------------------------
console.log('\n--- 4. Authoritative Server Action Invocation & Error Handling ---');

const handleLifecycleMatch = panelSrc.match(/const\s+handleLifecycleAction\s*=\s*async\s*\(\)\s*=>\s*\{([\s\S]+?)\};/);
assert(handleLifecycleMatch !== null, 'Extracted handleLifecycleAction definition');
const handleLifecycleCode = handleLifecycleMatch[1];

assert(
  handleLifecycleCode.includes('transitionWorkerAssignment(\n        assignment.assignment_id,\n        config.action\n      )') ||
  handleLifecycleCode.includes('transitionWorkerAssignment(assignment.assignment_id, config.action)'),
  'Invokes transitionWorkerAssignment with assignment.assignment_id and config.action'
);

assert(
  handleLifecycleCode.includes('if (!result.success) {'),
  'Checks !result.success on Server Action result'
);

assert(
  handleLifecycleCode.includes('result.error?.message') || handleLifecycleCode.includes('result.error.message'),
  'Extracts safe UI error message from result.error.message'
);

// ------------------------------------------------------------------------------
// SECTION 5: Elimination of Optimistic Lifecycle State
// ------------------------------------------------------------------------------
console.log('\n--- 5. Elimination of Optimistic Lifecycle State ---');

assert(!panelSrc.includes('useOptimistic'), 'No useOptimistic hook in worker panel');
assert(!panelSrc.includes('setAssignment('), 'No local setAssignment state modifier in worker panel');
assert(!panelSrc.includes('setAssignmentStatus'), 'No setAssignmentStatus modifier in worker panel');
assert(!panelSrc.includes('setIncidentStatus'), 'No setIncidentStatus modifier in worker panel');

// ------------------------------------------------------------------------------
// SECTION 6: Double-Submission Protection & Complete isBusy Contract
// ------------------------------------------------------------------------------
console.log('\n--- 6. Double-Submission Protection & isBusy Contract ---');

assert(
  panelSrc.includes('const [isActionPending, setIsActionPending] = useState(false);'),
  'Declares isActionPending state'
);
assert(
  panelSrc.includes('const [isRefreshPending, startRefreshTransition] = useTransition();'),
  'Declares isRefreshPending transition'
);
assert(
  panelSrc.includes('const isBusy = isActionPending || isRefreshPending;'),
  'Declares isBusy = isActionPending || isRefreshPending'
);

// Guard in handleLifecycleAction
assert(
  handleLifecycleCode.includes('if (isBusy || !assignment || !config) return;'),
  'handleLifecycleAction enforces early guard: if (isBusy || !assignment || !config) return;'
);

// Action button has disabled={isBusy}
const actionButtonMatch = panelSrc.match(/<Button[^>]+onClick=\{handleLifecycleAction\}[^>]*>/);
assert(actionButtonMatch !== null, 'Found lifecycle action button');
assert(actionButtonMatch[0].includes('disabled={isBusy}'), 'Lifecycle action button has disabled={isBusy}');

// Both manual refresh buttons have disabled={isBusy}
const refreshButtons = [...panelSrc.matchAll(/<Button[^>]+onClick=\{handleManualRefresh\}[^>]*>/g)];
assert(refreshButtons.length >= 2, `Found ${refreshButtons.length} manual refresh buttons (at least 2 required)`);
for (let i = 0; i < refreshButtons.length; i++) {
  assert(
    refreshButtons[i][0].includes('disabled={isBusy}'),
    `Manual refresh button #${i + 1} has disabled={isBusy}`
  );
}

// ------------------------------------------------------------------------------
// SECTION 7: Authoritative Success Refresh Transition Ordering
// ------------------------------------------------------------------------------
console.log('\n--- 7. Authoritative Success Refresh Transition Ordering ---');

const successMessageIndex = handleLifecycleCode.indexOf(
  'setSuccessMessage(config.successMessage);'
);

const successRefreshIndex = handleLifecycleCode.indexOf(
  'startRefreshTransition(',
  successMessageIndex
);

const successActionPendingIndex = handleLifecycleCode.indexOf(
  'setIsActionPending(false)',
  successRefreshIndex
);

assert(
  successMessageIndex !== -1,
  'Found success message handling in lifecycle action'
);

assert(
  successRefreshIndex !== -1,
  'startRefreshTransition is called in success path'
);

assert(
  successActionPendingIndex !== -1,
  'setIsActionPending(false) is called in success path'
);

assert(
  successRefreshIndex < successActionPendingIndex,
  'startRefreshTransition occurs BEFORE setIsActionPending(false) in success path'
);

// ------------------------------------------------------------------------------
// SECTION 8: All Three Stale-State Refresh Codes
// ------------------------------------------------------------------------------
console.log('\n--- 8. Stale-State Refresh Handling for All Three Codes ---');

const staleStateErrorBlock = handleLifecycleCode.match(/if\s*\([\s\S]+?result\.error\?\.code === 'ASSIGNMENT_NOT_FOUND'[\s\S]+?\)\s*\{([\s\S]+?)\}/);
assert(staleStateErrorBlock !== null, 'Found stale-state error handling block');

assert(
  handleLifecycleCode.includes("result.error?.code === 'ASSIGNMENT_NOT_FOUND'"),
  'Handles ASSIGNMENT_NOT_FOUND stale code'
);
assert(
  handleLifecycleCode.includes("result.error?.code === 'INVALID_TRANSITION'"),
  'Handles INVALID_TRANSITION stale code'
);
assert(
  handleLifecycleCode.includes("result.error?.code === 'ASSIGNMENT_CONFLICT'"),
  'Handles ASSIGNMENT_CONFLICT stale code'
);

assert(
  staleStateErrorBlock[1].includes('startRefreshTransition('),
  'Triggers startRefreshTransition on stale-state error codes'
);

// ------------------------------------------------------------------------------
// SECTION 9: Manual Refresh Contract
// ------------------------------------------------------------------------------
console.log('\n--- 9. Manual Refresh Contract ---');

const handleRefreshMatch = panelSrc.match(/const\s+handleManualRefresh\s*=\s*\(\)\s*=>\s*\{([\s\S]+?)\};/);
assert(handleRefreshMatch !== null, 'Extracted handleManualRefresh definition');
const handleRefreshCode = handleRefreshMatch[1];

assert(handleRefreshCode.includes('if (isBusy) return;'), 'handleManualRefresh checks if (isBusy) return;');
assert(handleRefreshCode.includes('setErrorMessage(null);'), 'handleManualRefresh clears stale error');
assert(
  handleRefreshCode.includes('startRefreshTransition(() => {\n      router.refresh();\n    });') ||
  handleRefreshCode.includes('startRefreshTransition(() => { router.refresh(); });') ||
  handleRefreshCode.includes('router.refresh()'),
  'handleManualRefresh triggers router.refresh inside startRefreshTransition'
);
assert(
  !handleRefreshCode.includes('setSuccessMessage('),
  'handleManualRefresh does NOT call setSuccessMessage(null) (prior success persists)'
);

// ------------------------------------------------------------------------------
// SECTION 10: COMPLETE_JOB Success Persistence & Unconditional Mounting
// ------------------------------------------------------------------------------
console.log('\n--- 10. COMPLETE_JOB Success Persistence & Unconditional Mounting ---');

// Unconditional mounting in WorkerPage
assert(
  workerPageSrc.includes('<WorkerAssignmentPanel assignment={assignment} />'),
  'WorkerPage unconditionally mounts <WorkerAssignmentPanel assignment={assignment} />'
);
assert(!workerPageSrc.includes('assignment && <WorkerAssignmentPanel'), 'No conditional assignment && mounting');
assert(!workerPageSrc.includes('assignment ? <WorkerAssignmentPanel'), 'No ternary assignment ? mounting');

// Success message rendering in null state
const nullAssignmentStart = panelSrc.indexOf('if (!assignment) {');
const nullReturnStart = panelSrc.indexOf('return (', nullAssignmentStart);
const activeAssignmentReturnStart = panelSrc.indexOf(
  '\n  return (',
  nullReturnStart + 1
);

assert(
  nullAssignmentStart !== -1 &&
  nullReturnStart !== -1 &&
  activeAssignmentReturnStart !== -1,
  'Extracted if (!assignment) return block'
);

const nullCardCode = panelSrc.slice(
  nullAssignmentStart,
  activeAssignmentReturnStart
);

assert(
  nullCardCode.includes('{successMessage && ('),
  'Null assignment state renders {successMessage && (...)} so COMPLETE_JOB survives assignment -> null'
);

// ------------------------------------------------------------------------------
// SECTION 11: Null State Truthfulness (No False "Idle" Claim)
// ------------------------------------------------------------------------------
console.log('\n--- 11. Null State Truthfulness ---');

assert(!/\bIdle\b/i.test(nullCardCode), 'Null assignment state does NOT contain false "Idle" claim');
assert(
  nullCardCode.includes('No active assignment available.'),
  'Null assignment state contains truthful message: "No active assignment available."'
);
assert(
  nullCardCode.includes('If you are expecting a job, refresh or contact dispatch.'),
  'Null assignment state retains guidance: "If you are expecting a job, refresh or contact dispatch."'
);

// ------------------------------------------------------------------------------
// SECTION 12: Safe Nullable Operational Fields & Direct tel: Link
// ------------------------------------------------------------------------------
console.log('\n--- 12. Safe Nullable Data & Direct tel: Link ---');

assert(
  panelSrc.includes('{assignment.location_address && ('),
  'location_address is conditionally rendered'
);
assert(
  panelSrc.includes('{(assignment.customer_name || assignment.customer_phone) && ('),
  'Customer card is conditionally rendered'
);
assert(
  panelSrc.includes('{assignment.customer_name && ('),
  'customer_name is conditionally rendered'
);
assert(
  panelSrc.includes('{assignment.customer_phone && ('),
  'customer_phone is conditionally rendered'
);
assert(
  panelSrc.includes('{assignment.vehicle_id !== null && assignment.callsign && ('),
  'Vehicle card is conditionally rendered'
);
assert(
  panelSrc.includes('{assignment.registration_number && ('),
  'registration_number is conditionally rendered'
);
assert(
  panelSrc.includes('{assignment.required_capability && ('),
  'required_capability is conditionally rendered'
);

// direct tel: link check
assert(
  panelSrc.includes('href={`tel:${assignment.customer_phone}`}'),
  'Direct tel: URI is rendered strictly for genuine customer_phone'
);

// location_description forbidden in Phase 7B
assert(!panelSrc.includes('location_description'), 'location_description does NOT appear in worker panel');
assert(!workerPageSrc.includes('location_description'), 'location_description does NOT appear in worker page');

// ------------------------------------------------------------------------------
// SECTION 13: Accessibility Compliance
// ------------------------------------------------------------------------------
console.log('\n--- 13. Accessibility Compliance ---');

// Buttons have type="button"
const allButtons = [...panelSrc.matchAll(/<Button\s+([^>]+)>/g)];
for (const btn of allButtons) {
  assert(btn[1].includes('type="button"'), `Button "${btn[0]}" explicitly has type="button"`);
}

// Error feedback role="alert"
assert(panelSrc.includes('role="alert"'), 'Error feedback element uses role="alert"');

// Success / pending feedback aria-live="polite"
assert(panelSrc.includes('aria-live="polite"'), 'Success/pending feedback element uses aria-live="polite"');

// Action button size
assert(
  panelSrc.includes('w-full') && panelSrc.includes('min-h-[44px]'),
  'Lifecycle action button has mobile-friendly w-full and min-h-[44px]'
);

// ------------------------------------------------------------------------------
// SECTION 14: Mobile Hardening (~320px screen width)
// ------------------------------------------------------------------------------
console.log('\n--- 14. Mobile Hardening (~320px screens) ---');

// WorkerPage identity rows hardening
assert(
  workerPageSrc.includes('flex flex-col items-start gap-1 min-w-0 sm:flex-row sm:items-center sm:justify-between sm:gap-2'),
  'WorkerPage identity rows use mobile-first stacked flex-col layout transitioning to sm:flex-row'
);

assert(
  workerPageSrc.includes('{profile.display_name}') &&
  workerPageSrc.includes('break-words whitespace-normal min-w-0'),
  'profile.display_name has break-words whitespace-normal min-w-0'
);

assert(
  workerPageSrc.includes('{organization.name}') &&
  workerPageSrc.includes('break-words whitespace-normal min-w-0'),
  'organization.name has break-words whitespace-normal min-w-0'
);

// "Restricted to Assigned Incidents" badge does not shrink-0 and wraps safely
const rlsBadgeMatch = workerPageSrc.match(/<Badge[^>]*variant="success"[^>]*>[\s\S]+?Restricted to Assigned Incidents[\s\S]+?<\/Badge>/);
assert(rlsBadgeMatch !== null, 'Found RLS Access Scope badge');
assert(
  rlsBadgeMatch[0].includes('whitespace-normal') &&
  rlsBadgeMatch[0].includes('break-words') &&
  rlsBadgeMatch[0].includes('max-w-full') &&
  !rlsBadgeMatch[0].includes('shrink-0'),
  'RLS Access Scope badge wraps safely (whitespace-normal break-words max-w-full) without forced shrink-0'
);

// WorkerAssignmentPanel hardening
assert(panelSrc.includes('break-words whitespace-normal min-w-0'), 'Panel fields use break-words whitespace-normal min-w-0');

// ------------------------------------------------------------------------------
// SECTION 15: Authoritative Badge Variant Verification
// ------------------------------------------------------------------------------
console.log('\n--- 15. Badge Variant Verification Against Existing Component ---');

const badgePath = path.join(rootDir, 'src/components/ui/badge.tsx');
assert(fs.existsSync(badgePath), 'src/components/ui/badge.tsx exists');
const badgeSrc = fs.readFileSync(badgePath, 'utf8');

const variantMatch = badgeSrc.match(/variant\?:\s*([^;]+);/);
assert(variantMatch !== null, 'Extracted variant prop union from badge.tsx');
const supportedVariants = new Set(
  variantMatch[1]
    .split('|')
    .map((v) => v.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
);

for (const match of workerPageSrc.matchAll(/<Badge[^>]*variant=["']([^"']+)["']/g)) {
  assert(supportedVariants.has(match[1]), `WorkerPage uses supported Badge variant "${match[1]}"`);
}

for (const match of panelSrc.matchAll(/<Badge[^>]*variant=["']([^"']+)["']/g)) {
  assert(supportedVariants.has(match[1]), `WorkerAssignmentPanel uses supported Badge variant "${match[1]}"`);
}

// ------------------------------------------------------------------------------
// SECTION 16: Full Phase Boundary Quarantine
// ------------------------------------------------------------------------------
console.log('\n--- 16. Full Phase Boundary Quarantine ---');

const forbiddenBoundarySymbols = [
  'watchPosition',
  'getCurrentPosition',
  'navigator.geolocation',
  'geolocation',
  'postgres_changes',
  '.channel(',
  '.subscribe(',
  'setInterval(',
  'serviceWorker',
  'Mapbox',
  'mapbox',
  'Twilio',
  'twilio',
  'Vapi',
  'vapi',
];

const phase7bSrcFiles = [
  { name: 'worker/page.tsx', src: workerPageSrc },
  { name: 'worker-assignment-panel.tsx', src: panelSrc },
];

for (const file of phase7bSrcFiles) {
  for (const symbol of forbiddenBoundarySymbols) {
    assert(
      !file.src.includes(symbol),
      `Boundary check: "${file.name}" does NOT contain forbidden symbol "${symbol}"`
    );
  }
}

// ------------------------------------------------------------------------------
// SUMMARY
// ------------------------------------------------------------------------------
console.log('\n================================================================');
console.log(`  PHASE 7B VERIFICATION COMPLETE: ${passedChecks} / ${totalChecks} PASSED (0 FAILED)`);
console.log('================================================================\n');

process.exit(0);
