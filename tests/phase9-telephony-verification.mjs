/**
 * Phase 9 Telephony, SMS & Operator Flow Static Verification Suite
 * Phase 9E Verification / Quarantine (Hardened)
 *
 * Verifies Phase 9A, 9B, 9C, and 9D implementation:
 * 1. Database Foundation & Table Field Contract (Phase 9A)
 * 2. Organization Integration Credential & Secret Storage (Phase 9A)
 * 3. Integration RPC Security & Provider Scoping (Phase 9A)
 * 4. Voice Intake RPC Contract & Idempotency (Phase 9A)
 * 5. Automated Location Token RPC Contract (Phase 9A)
 * 6. Operator Attach RPC Contract (Phase 9A)
 * 7. Monotonic SMS Status Progression & Monotonic Ranks (Phase 9A)
 * 8. Vapi Webhook Route & Pure Validator (Phase 9B)
 * 9. Twilio Transport Client & Signature Validator (Phase 9C)
 * 10. Automated SMS Orchestrator (Phase 9C)
 * 11. Twilio Status Callback Webhook Route (Phase 9C)
 * 12. Environment Variables Contract (.env.example & Server Code)
 * 13. Operator Location SMS Server Action (Phase 9D)
 * 14. Operator Customer Location Link & SMS Client UI (Phase 9D)
 * 15. Operator Incident Page Wiring (Phase 9D)
 * 16. Zero Service-Role & Zero Direct Mutation Invariants
 * 17. Static Suite Self-Audit for Network Safety
 * 18. Locked File Quarantine (relative to baseline 577ce0c)
 *
 * Zero network requests. Zero live provider calls. Zero database mutations.
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
 * Strips SQL comments to prevent false matches in commented code
 */
function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((line) => {
      const idx = line.indexOf('--');
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join('\n');
}

/**
 * Strips JS/TS comments to prevent false matches in commented code
 */
function stripCodeComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((line) => {
      const idx = line.indexOf('//');
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join('\n');
}

console.log('================================================================');
console.log('  MATOS SYSTEMS — PHASE 9 TELEPHONY, SMS & OPERATOR VERIFICATION');
console.log('================================================================\n');

const baselineCommit = '577ce0c';
const currentHead = execSync('git rev-parse HEAD', { cwd: rootDir, encoding: 'utf8' }).trim();
assert(
  currentHead.startsWith(baselineCommit),
  `Trimmed HEAD must start with / resolve to baseline commit ${baselineCommit} (got: ${currentHead})`
);

// ------------------------------------------------------------------------------
// SECTION 1: Database Foundation & Table Field Contract (Phase 9A)
// ------------------------------------------------------------------------------
console.log('--- 1. Database Foundation & Table Field Contract (Phase 9A) ---');

const migrationsDir = path.join(rootDir, 'supabase/migrations');
const migrationFiles = fs.readdirSync(migrationsDir).sort();

const phase8Migration = '20261001080000_phase8_customer_location_verification.sql';
const phase9Migration = '20261001120000_phase9_voice_intake_and_sms_gateway.sql';

assert(migrationFiles.includes(phase9Migration), 'Phase 9 migration exists');
assert(
  migrationFiles.indexOf(phase9Migration) > migrationFiles.indexOf(phase8Migration),
  'Phase 9 migration sorts sequentially after Phase 8'
);

const phase9MigrationsCount = migrationFiles.filter((f) => f.includes('phase9')).length;
assert(phase9MigrationsCount === 1, 'Exactly one Phase 9 migration exists in migrations directory');

const phase9SqlPath = path.join(migrationsDir, phase9Migration);
const phase9Sql = fs.readFileSync(phase9SqlPath, 'utf8');
const cleanSql = stripSqlComments(phase9Sql);

// Evolution of Phase 8 customer_location_requests: created_by becomes nullable
assert(
  /ALTER\s+TABLE\s+public\.customer_location_requests\s+ALTER\s+COLUMN\s+created_by\s+DROP\s+NOT\s+NULL;/i.test(
    cleanSql
  ),
  'Phase 8 customer_location_requests.created_by column altered to DROP NOT NULL'
);

// customer_location_sms_dispatches table definition
assert(
  cleanSql.includes('CREATE TABLE IF NOT EXISTS public.customer_location_sms_dispatches'),
  'customer_location_sms_dispatches table defined'
);

const dispatchesBlock = cleanSql
  .split('CREATE TABLE IF NOT EXISTS public.customer_location_sms_dispatches')[1]
  .split(');')[0];

// Exact column field declarations (name, type, nullability, defaults)
const requiredColumnDefinitions = [
  { name: 'id', regex: /id\s+UUID\s+PRIMARY\s+KEY\s+DEFAULT\s+gen_random_uuid\(\)/i },
  { name: 'organization_id', regex: /organization_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+public\.organizations\(id\)\s+ON\s+DELETE\s+CASCADE/i },
  { name: 'incident_id', regex: /incident_id\s+UUID\s+NOT\s+NULL/i },
  { name: 'request_id', regex: /request_id\s+UUID\s+NULL/i },
  { name: 'idempotency_key', regex: /idempotency_key\s+TEXT\s+NOT\s+NULL/i },
  { name: 'recipient_phone', regex: /recipient_phone\s+TEXT\s+NOT\s+NULL/i },
  { name: 'sender_id', regex: /sender_id\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'MATOSROAD'/i },
  { name: 'provider_message_sid', regex: /provider_message_sid\s+TEXT\s+NULL/i },
  { name: 'status', regex: /status\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'reserved'/i },
  { name: 'error_code', regex: /error_code\s+TEXT\s+NULL/i },
  { name: 'error_message', regex: /error_message\s+TEXT\s+NULL/i },
  { name: 'dispatched_by', regex: /dispatched_by\s+UUID\s+NULL/i },
  { name: 'created_at', regex: /created_at\s+TIMESTAMPTZ\s+NOT\s+NULL\s+DEFAULT\s+now\(\)/i },
  { name: 'updated_at', regex: /updated_at\s+TIMESTAMPTZ\s+NOT\s+NULL\s+DEFAULT\s+now\(\)/i },
];

requiredColumnDefinitions.forEach((col) => {
  assert(col.regex.test(dispatchesBlock), `customer_location_sms_dispatches declares column: ${col.name} with exact type and constraints`);
});

// Allowed status whitelist check in table constraint contains all and only the 8 locked statuses
const statusCheckMatch = dispatchesBlock.match(/CHECK\s*\(\s*status\s+IN\s*\(([^)]+)\)\s*\)/i);
assert(statusCheckMatch !== null, 'customer_location_sms_dispatches has CHECK constraint on status IN (...)');

const extractedStatuses = statusCheckMatch[1]
  .split(',')
  .map((s) => s.trim().replace(/^'|'$/g, ''))
  .sort();

const expectedStatuses = [
  'accepted',
  'delivered',
  'failed',
  'queued',
  'reserved',
  'sending',
  'sent',
  'undelivered',
].sort();

assert(
  JSON.stringify(extractedStatuses) === JSON.stringify(expectedStatuses),
  `customer_location_sms_dispatches status CHECK contains all and only the 8 locked statuses: [${expectedStatuses.join(', ')}]`
);

assert(
  dispatchesBlock.includes('UNIQUE (organization_id, idempotency_key)'),
  'customer_location_sms_dispatches enforces uniqueness on (organization_id, idempotency_key)'
);
assert(
  dispatchesBlock.includes('UNIQUE (provider_message_sid)'),
  'customer_location_sms_dispatches enforces uniqueness on provider_message_sid'
);
assert(
  /FOREIGN\s+KEY\s*\(\s*incident_id\s*,\s*organization_id\s*\)\s+REFERENCES\s+public\.incidents\s*\(\s*id\s*,\s*organization_id\s*\)/i.test(
    dispatchesBlock
  ),
  'customer_location_sms_dispatches enforces composite FK to incidents'
);
assert(
  /FOREIGN\s+KEY\s*\(\s*request_id\s*,\s*organization_id\s*,\s*incident_id\s*\)\s+REFERENCES\s+public\.customer_location_requests\s*\(\s*id\s*,\s*organization_id\s*,\s*incident_id\s*\)/i.test(
    dispatchesBlock
  ),
  'customer_location_sms_dispatches enforces composite FK to customer_location_requests'
);
assert(
  dispatchesBlock.includes("CHECK (recipient_phone ~ '^\\+[1-9][0-9]{6,14}$')"),
  'customer_location_sms_dispatches enforces E.164 format on recipient_phone'
);
assert(
  dispatchesBlock.includes("CHECK (status IN ('reserved', 'failed') OR request_id IS NOT NULL)"),
  'customer_location_sms_dispatches requires request_id attached before active provider statuses'
);
assert(
  cleanSql.includes('ALTER TABLE public.customer_location_sms_dispatches ENABLE ROW LEVEL SECURITY;'),
  'RLS enabled on customer_location_sms_dispatches'
);
assert(
  /REVOKE\s+ALL\s+ON\s+public\.customer_location_sms_dispatches\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*;/i.test(
    cleanSql
  ),
  'Explicit fail-closed privileges on customer_location_sms_dispatches (REVOKE ALL from PUBLIC, anon, authenticated)'
);
assert(
  /GRANT\s+SELECT\s+ON\s+public\.customer_location_sms_dispatches\s+TO\s+authenticated\s*;/i.test(cleanSql),
  'Only SELECT is granted to authenticated on customer_location_sms_dispatches'
);
assert(
  cleanSql.includes('CREATE POLICY sms_dispatches_select_operator_admin'),
  'RLS SELECT policy defined for operators and admins'
);
const smsDispatchPolicyMatch = cleanSql.match(/CREATE\s+POLICY\s+sms_dispatches_select_operator_admin[\s\S]*?;/i);
assert(smsDispatchPolicyMatch !== null, 'sms_dispatches_select_operator_admin policy block exists');
const smsDispatchPolicyBlock = smsDispatchPolicyMatch[0];
assert(
  smsDispatchPolicyBlock.includes('organization_id = public.get_current_user_organization_id()') &&
    /public\.get_current_user_role\(\)\s+IN\s*\(\s*'admin'\s*,\s*'operator'\s*\)/i.test(smsDispatchPolicyBlock),
  'sms_dispatches_select_operator_admin policy requires organization_id = public.get_current_user_organization_id() AND public.get_current_user_role() IN (\'admin\', \'operator\')'
);

// Idempotent Supabase Realtime registration
assert(
  cleanSql.includes("tablename = 'customer_location_sms_dispatches'") &&
    cleanSql.includes('pg_publication_tables') &&
    cleanSql.includes('ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_location_sms_dispatches;'),
  'customer_location_sms_dispatches idempotently registered in supabase_realtime publication'
);

// intake_idempotency_keys table
assert(
  cleanSql.includes('CREATE TABLE IF NOT EXISTS public.intake_idempotency_keys'),
  'intake_idempotency_keys table defined'
);
assert(
  cleanSql.includes("CHECK (provider IN ('vapi'))") || cleanSql.includes("CHECK (provider = 'vapi')"),
  'intake_idempotency_keys provider constrained to vapi'
);
assert(
  cleanSql.includes('UNIQUE (organization_id, provider, idempotency_key)'),
  'intake_idempotency_keys enforces uniqueness per organization, provider, and idempotency key'
);
assert(
  /FOREIGN\s+KEY\s*\(\s*incident_id\s*,\s*organization_id\s*\)\s+REFERENCES\s+public\.incidents\s*\(\s*id\s*,\s*organization_id\s*\)/i.test(
    cleanSql
  ),
  'intake_idempotency_keys composite FK to incidents is tenant-safe'
);
assert(
  cleanSql.includes('ALTER TABLE public.intake_idempotency_keys ENABLE ROW LEVEL SECURITY;'),
  'RLS enabled on intake_idempotency_keys'
);
assert(
  /REVOKE\s+ALL\s+ON\s+public\.intake_idempotency_keys\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*;/i.test(
    cleanSql
  ),
  'Explicit fail-closed privileges on intake_idempotency_keys (REVOKE ALL from PUBLIC, anon, authenticated)'
);

// ------------------------------------------------------------------------------
// SECTION 2: Organization Integration Credential & Secret Storage (Phase 9A)
// ------------------------------------------------------------------------------
console.log('\n--- 2. Organization Integration Credential & Secret Storage (Phase 9A) ---');

assert(
  cleanSql.includes('CREATE TABLE IF NOT EXISTS public.organization_integrations'),
  'organization_integrations table defined'
);
assert(
  cleanSql.includes("CHECK (provider IN ('vapi', 'twilio'))"),
  'organization_integrations.provider restricted strictly to vapi and twilio'
);
assert(
  cleanSql.includes('integration_token_hash TEXT NOT NULL'),
  'organization_integrations.integration_token_hash column defined'
);
assert(
  cleanSql.includes('UNIQUE (organization_id, provider)'),
  'organization_integrations enforces unique organization_id and provider'
);
assert(
  cleanSql.includes('UNIQUE (provider, integration_token_hash)'),
  'organization_integrations enforces unique provider and integration_token_hash'
);
assert(
  cleanSql.includes('ALTER TABLE public.organization_integrations ENABLE ROW LEVEL SECURITY;'),
  'RLS enabled on organization_integrations'
);
assert(
  /REVOKE\s+ALL\s+ON\s+public\.organization_integrations\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*;/i.test(
    cleanSql
  ),
  'Explicit fail-closed privileges on organization_integrations (REVOKE ALL from PUBLIC, anon, authenticated)'
);

// Prove table definition has integration_token_hash and does NOT define plaintext credential columns
const orgIntegrationsBlock = cleanSql
  .split('CREATE TABLE IF NOT EXISTS public.organization_integrations')[1]
  .split(');')[0];

const forbiddenPlaintextColumns = ['integration_secret', 'secret', 'token', 'auth_token', 'api_key'];
forbiddenPlaintextColumns.forEach((col) => {
  const colRegex = new RegExp(`^\\s*${col}\\s+`, 'im');
  assert(!colRegex.test(orgIntegrationsBlock), `organization_integrations does NOT define plaintext credential column: ${col}`);
});

// ------------------------------------------------------------------------------
// SECTION 3: Integration RPC Security & Provider Scoping (Phase 9A)
// ------------------------------------------------------------------------------
console.log('\n--- 3. Integration RPC Security & Provider Scoping (Phase 9A) ---');

const integrationRpcs = [
  'create_voice_intake_incident',
  'create_automated_customer_location_request',
  'reserve_customer_location_sms_integration',
  'finalize_customer_location_sms_send_integration',
  'record_sms_status_callback',
];

integrationRpcs.forEach((rpc) => {
  assert(cleanSql.includes(`CREATE OR REPLACE FUNCTION public.${rpc}`), `Integration RPC exists: ${rpc}`);
});

// Vapi provider scoped RPCs
const vapiRpcs = [
  'create_voice_intake_incident',
  'create_automated_customer_location_request',
  'reserve_customer_location_sms_integration',
  'finalize_customer_location_sms_send_integration',
];

vapiRpcs.forEach((rpc) => {
  const rpcBody = cleanSql.split(`FUNCTION public.${rpc}`)[1].split('$$;')[0];
  assert(rpcBody.includes("provider = 'vapi'"), `${rpc} authenticates with provider = 'vapi'`);
  assert(
    rpcBody.includes("encode(extensions.digest(trim(p_integration_secret), 'sha256'), 'hex')"),
    `${rpc} hashes integration secret using SHA-256`
  );
  assert(
    !/p_organization_id/i.test(rpcBody.split('AS $$')[0]),
    `${rpc} does not accept organization_id from caller; derives organization_id solely from authenticated secret`
  );
});

// Twilio status callback RPC scoping
const callbackRpcBody = cleanSql.split('FUNCTION public.record_sms_status_callback')[1].split('$$;')[0];
assert(
  callbackRpcBody.includes("provider = 'twilio'"),
  'record_sms_status_callback authenticates with provider = twilio'
);
assert(
  callbackRpcBody.includes("encode(extensions.digest(trim(p_integration_secret), 'sha256'), 'hex')"),
  'record_sms_status_callback hashes DB secret using SHA-256'
);
assert(
  !/p_organization_id/i.test(callbackRpcBody.split('AS $$')[0]),
  'record_sms_status_callback does not accept organization_id parameter from caller'
);

// Integration RPC function signature REVOKE FROM PUBLIC and GRANT EXECUTE TO anon
const integrationRpcNames = [
  'create_voice_intake_incident',
  'create_automated_customer_location_request',
  'reserve_customer_location_sms_integration',
  'finalize_customer_location_sms_send_integration',
  'record_sms_status_callback',
];

integrationRpcNames.forEach((rpcName) => {
  const revokeRegex = new RegExp(`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${rpcName}\\s*\\([^)]*\\)\\s+FROM\\s+PUBLIC\\s*;`, 'i');
  assert(
    revokeRegex.test(cleanSql),
    `Integration RPC ${rpcName} signature revokes all from PUBLIC`
  );
  const grantAnonRegex = new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${rpcName}\\s*\\([^)]*\\)\\s+TO\\s+anon\\s*;`, 'i');
  assert(
    grantAnonRegex.test(cleanSql),
    `Integration RPC ${rpcName} grants EXECUTE only to anon`
  );
  const grantAuthRegex = new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${rpcName}\\s*\\([^)]*\\)\\s+TO\\s+authenticated`, 'i');
  assert(
    !grantAuthRegex.test(cleanSql),
    `Integration RPC ${rpcName} is NOT granted to authenticated`
  );
});

// Deduplicated failed callback terminal audit
assert(
  /ELSIF\s+v_clean_status\s+IN\s*\(\s*'undelivered'\s*,\s*'failed'\s*\)\s+THEN[\s\S]*?CUSTOMER_LOCATION_SMS_FAILED[\s\S]*?\(metadata->>'dispatch_id'\)\s*=\s*p_dispatch_id::text/i.test(
    callbackRpcBody
  ),
  'record_sms_status_callback routes both undelivered and failed to deduplicated CUSTOMER_LOCATION_SMS_FAILED branch using dispatch_id'
);

// ------------------------------------------------------------------------------
// SECTION 4: Voice Intake RPC Contract & Idempotency (Phase 9A)
// ------------------------------------------------------------------------------
console.log('\n--- 4. Voice Intake RPC Contract & Idempotency (Phase 9A) ---');

const voiceIntakeBody = cleanSql.split('FUNCTION public.create_voice_intake_incident')[1].split('$$;')[0];

assert(
  voiceIntakeBody.includes('pg_advisory_xact_lock'),
  'create_voice_intake_incident acquires transaction-scoped advisory lock for idempotency'
);
assert(
  voiceIntakeBody.includes('FROM public.intake_idempotency_keys'),
  'create_voice_intake_incident checks idempotency inside the lock'
);

// Mandatory field validation branches
assert(
  /p_customer_name\s+IS\s+NULL\s+OR\s+length\(trim\(p_customer_name\)\)\s*=\s*0/i.test(voiceIntakeBody) &&
    voiceIntakeBody.includes("RAISE EXCEPTION 'Customer name is required'"),
  'create_voice_intake_incident has explicit customer name non-empty validation branch'
);
assert(
  /p_customer_phone\s+IS\s+NULL\s+OR\s+length\(trim\(p_customer_phone\)\)\s*=\s*0/i.test(voiceIntakeBody) &&
    voiceIntakeBody.includes("RAISE EXCEPTION 'Customer phone is required'"),
  'create_voice_intake_incident has explicit customer phone non-empty validation branch'
);
assert(
  /p_location_address\s+IS\s+NULL\s+OR\s+length\(trim\(p_location_address\)\)\s*=\s*0/i.test(voiceIntakeBody) &&
    voiceIntakeBody.includes("RAISE EXCEPTION 'Location address is required'"),
  'create_voice_intake_incident has explicit location address non-empty validation branch'
);

// Service type whitelist validation
const serviceTypeWhitelistMatch = voiceIntakeBody.match(/v_service_type\s+NOT\s+IN\s*\(([^)]+)\)/i);
assert(serviceTypeWhitelistMatch !== null, 'create_voice_intake_incident validates v_service_type against whitelist');
const extractedServiceTypes = serviceTypeWhitelistMatch[1]
  .split(',')
  .map((s) => s.trim().replace(/^'|'$/g, ''))
  .sort();
const expectedServiceTypes = [
  'fuel_delivery',
  'general_assistance',
  'jump_start',
  'lockout',
  'tire_change',
  'towing',
  'winch_recovery',
].sort();
assert(
  JSON.stringify(extractedServiceTypes) === JSON.stringify(expectedServiceTypes),
  'create_voice_intake_incident service_type whitelist contains all and only locked service types'
);

// Priority whitelist validation
assert(
  /v_priority\s+NOT\s+IN\s*\(\s*'low'\s*,\s*'standard'\s*,\s*'high'\s*,\s*'critical'\s*\)/i.test(voiceIntakeBody),
  'create_voice_intake_incident priority whitelist contains low, standard, high, critical'
);

// Active service capability lookup
assert(
  /FROM\s+public\.service_capabilities\s+WHERE\s+code\s*=\s*v_cap_code\s+AND\s+is_active\s*=\s*true/i.test(voiceIntakeBody),
  'create_voice_intake_incident capability lookup verifies is_active = true'
);

// Vehicle year validation
assert(
  voiceIntakeBody.includes('p_vehicle_year < 1900 OR p_vehicle_year > 2100'),
  'create_voice_intake_incident validates vehicle year between 1900 and 2100'
);

// Capability mapping
assert(
  /WHEN\s+'tire_change'\s+THEN\s+'tire_assistance'/i.test(voiceIntakeBody),
  'create_voice_intake_incident maps tire_change to tire_assistance capability'
);

// Incident INSERT explicitly sets created_by = NULL, location_source = 'telephony_intake', status = 'new'
const incInsert = voiceIntakeBody.split('INSERT INTO public.incidents')[1].split('RETURNING')[0];
const [incidentColsPart, incidentValsPart] = incInsert.split('VALUES');

assert(
  incidentColsPart.includes('created_by') &&
    /,\s*NULL\s*\)\s*$/m.test(incidentValsPart.trim()),
  'incident INSERT sets created_by to NULL'
);
assert(
  incidentColsPart.includes('location_source') &&
    incidentValsPart.includes("'telephony_intake'"),
  "incident INSERT sets location_source to 'telephony_intake'"
);
assert(
  incidentColsPart.includes('status') &&
    incidentValsPart.includes("'new'"),
  "incident INSERT sets status to 'new'"
);

// VOICE_INCIDENT_CREATED event has actor_id = NULL
const eventInsert = voiceIntakeBody.split('INSERT INTO public.operational_events')[1].split(');')[0];
const [eventColsPart, eventValsPart] = eventInsert.split('VALUES');

assert(
  eventColsPart.includes('event_type') && eventValsPart.includes("'VOICE_INCIDENT_CREATED'"),
  "operational_events event_type is 'VOICE_INCIDENT_CREATED'"
);
assert(
  eventColsPart.includes('actor_id') &&
    /'VOICE_INCIDENT_CREATED'\s*,\s*NULL\s*,/i.test(eventValsPart),
  'operational_events actor_id is explicitly NULL'
);

// Idempotency key atomically recorded
assert(
  voiceIntakeBody.includes('INSERT INTO public.intake_idempotency_keys'),
  'create_voice_intake_incident records idempotency key atomically'
);

// Duplicate return payload uses actual stored status
const dupReturnBlock = voiceIntakeBody
  .split('IF v_existing_incident_id IS NOT NULL THEN')[1]
  .split('END IF;')[0];
assert(
  dupReturnBlock.includes("'incident_id', v_existing_incident_id") &&
    dupReturnBlock.includes("'reference_number', v_existing_ref") &&
    dupReturnBlock.includes("'status', v_existing_status") &&
    dupReturnBlock.includes("'is_duplicate', true"),
  'Duplicate return payload includes actual stored incident status, incident_id, reference_number, is_duplicate true'
);

// Fresh return payload
const freshReturnBlock = voiceIntakeBody.split('INSERT INTO public.operational_events')[1];
assert(
  freshReturnBlock.includes("'incident_id', v_incident_id") &&
    freshReturnBlock.includes("'reference_number', v_reference_number") &&
    freshReturnBlock.includes("'status', 'new'") &&
    freshReturnBlock.includes("'is_duplicate', false"),
  "Fresh return payload includes incident_id, reference_number, status 'new', is_duplicate false"
);

// ------------------------------------------------------------------------------
// SECTION 5: Automated Location Token RPC Contract (Phase 9A)
// ------------------------------------------------------------------------------
console.log('\n--- 5. Automated Location Token RPC Contract (Phase 9A) ---');

const autoTokenBody = cleanSql.split('FUNCTION public.create_automated_customer_location_request')[1].split('$$;')[0];

assert(autoTokenBody.includes("provider = 'vapi'"), 'create_automated_customer_location_request authenticates provider = vapi');

// Incident lock occurs before dispatch lock by source position
const incLockPos = autoTokenBody.search(/FROM\s+public\.incidents[\s\S]*?FOR\s+UPDATE/i);
const dispLockPos = autoTokenBody.search(/FROM\s+public\.customer_location_sms_dispatches[\s\S]*?FOR\s+UPDATE/i);
assert(
  incLockPos >= 0 && dispLockPos >= 0 && incLockPos < dispLockPos,
  'Incident FOR UPDATE lock occurs before dispatch FOR UPDATE lock by source position'
);

assert(
  autoTokenBody.includes("v_incident_status IN ('completed', 'cancelled', 'unable_to_complete')"),
  'create_automated_customer_location_request rejects terminal incident'
);
assert(
  autoTokenBody.includes('organization_id = v_org_id'),
  'Dispatch reservation must belong to authenticated organization'
);
assert(
  autoTokenBody.includes('incident_id = p_incident_id'),
  'Dispatch reservation must belong to specified incident'
);
assert(
  autoTokenBody.includes("v_disp_status <> 'reserved'"),
  'create_automated_customer_location_request requires reserved dispatch'
);
assert(
  autoTokenBody.includes('v_disp_req_id IS NOT NULL'),
  'create_automated_customer_location_request requires dispatch request_id to be NULL'
);

// Revocation checks: used_at IS NULL, revoked_at IS NULL, expires_at > v_now
assert(
  /UPDATE\s+public\.customer_location_requests\s+SET\s+revoked_at\s*=\s*v_now/i.test(autoTokenBody) &&
    autoTokenBody.includes('used_at IS NULL') &&
    autoTokenBody.includes('revoked_at IS NULL') &&
    autoTokenBody.includes('expires_at > v_now'),
  'Revocation query verifies used_at IS NULL, revoked_at IS NULL, and expires_at > v_now'
);

assert(
  autoTokenBody.includes('extensions.gen_random_bytes(32)'),
  'create_automated_customer_location_request generates 32 cryptographically secure random bytes'
);
assert(
  autoTokenBody.includes("extensions.digest(v_raw_token, 'sha256')"),
  'create_automated_customer_location_request stores SHA-256 hash of token'
);
assert(
  /INTERVAL\s+'1 hour'/i.test(autoTokenBody),
  'create_automated_customer_location_request sets 1-hour expiration'
);

// created_by is explicitly NULL in customer_location_requests insert
const reqInsert = autoTokenBody.split('INSERT INTO public.customer_location_requests')[1].split('RETURNING')[0];
const [reqColsPart, reqValsPart] = reqInsert.split('VALUES');

assert(
  reqColsPart.includes('created_by') &&
    /,\s*NULL\s*,\s*v_now/i.test(reqValsPart),
  'customer_location_requests.created_by is set to NULL'
);

// request_id attached to dispatch
assert(
  /UPDATE\s+public\.customer_location_sms_dispatches\s+SET\s+request_id\s*=\s*v_request_id/i.test(autoTokenBody),
  'request_id is attached to the reserved customer_location_sms_dispatches row'
);

// Returned payload validation
assert(
  autoTokenBody.includes("'success', true") &&
    autoTokenBody.includes("'token', v_raw_token") &&
    autoTokenBody.includes("'request_id', v_request_id") &&
    autoTokenBody.includes("'expires_at', v_expires_at") &&
    autoTokenBody.includes("'/customer/location/' || v_raw_token"),
  'Returned payload contains success, token, request_id, expires_at, and relative_path'
);

// ------------------------------------------------------------------------------
// SECTION 6: Operator Attach RPC Contract (Phase 9A)
// ------------------------------------------------------------------------------
console.log('\n--- 6. Operator Attach RPC Contract (Phase 9A) ---');

const attachOperatorBody = cleanSql.split('FUNCTION public.attach_customer_location_request_to_sms_dispatch_operator')[1].split('$$;')[0];

assert(
  attachOperatorBody.includes('v_caller_uid := auth.uid();') &&
    attachOperatorBody.includes('IF v_caller_uid IS NULL THEN'),
  'attach_customer_location_request_to_sms_dispatch_operator requires auth.uid()'
);
assert(
  attachOperatorBody.includes("v_caller_role NOT IN ('admin', 'operator')"),
  'attach_customer_location_request_to_sms_dispatch_operator requires admin or operator role'
);
assert(
  attachOperatorBody.includes("p_token ~ '^[0-9a-fA-F]{64}$'") &&
    attachOperatorBody.includes('length(trim(p_token)) != 64'),
  'attach_customer_location_request_to_sms_dispatch_operator requires 64-hex token'
);
assert(
  attachOperatorBody.includes("encode(extensions.digest(trim(p_token), 'sha256'), 'hex')"),
  'attach_customer_location_request_to_sms_dispatch_operator hashes token via SHA-256'
);
assert(
  attachOperatorBody.includes('organization_id = v_caller_org'),
  'attach_customer_location_request_to_sms_dispatch_operator confines lookups to caller organization'
);
assert(
  attachOperatorBody.includes('v_created_by <> v_caller_uid'),
  'attach_customer_location_request_to_sms_dispatch_operator validates request creator is current operator'
);
assert(
  attachOperatorBody.includes('v_used_at IS NOT NULL'),
  'attach_customer_location_request_to_sms_dispatch_operator requires request to be unused'
);
assert(
  attachOperatorBody.includes('v_revoked_at IS NOT NULL'),
  'attach_customer_location_request_to_sms_dispatch_operator requires request to be unrevoked'
);
assert(
  attachOperatorBody.includes('v_expires_at <= v_now'),
  'attach_customer_location_request_to_sms_dispatch_operator requires request to be unexpired'
);

// Canonical lock ordering by source POSITION
const opIncLockPos = attachOperatorBody.indexOf('SELECT status\n  INTO v_incident_status\n  FROM public.incidents');
const opReqLockPos = attachOperatorBody.indexOf('FROM public.customer_location_requests\n  WHERE id = v_req_id');
const opDispLockPos = attachOperatorBody.indexOf('FROM public.customer_location_sms_dispatches\n  WHERE id = p_dispatch_id');

assert(
  opIncLockPos >= 0 && opReqLockPos >= 0 && opDispLockPos >= 0 &&
    opIncLockPos < opReqLockPos && opReqLockPos < opDispLockPos,
  'Operator attach RPC enforces canonical lock order: incident FOR UPDATE -> customer_location_requests FOR UPDATE -> SMS dispatch FOR UPDATE'
);

assert(
  attachOperatorBody.includes('v_disp_incident_id <> v_incident_id'),
  'attach_customer_location_request_to_sms_dispatch_operator validates request and dispatch belong to same incident'
);
assert(
  attachOperatorBody.includes("v_disp_status <> 'reserved'"),
  'attach_customer_location_request_to_sms_dispatch_operator requires dispatch to be reserved'
);
assert(
  attachOperatorBody.includes('v_disp_req_id IS NOT NULL'),
  'attach_customer_location_request_to_sms_dispatch_operator prohibits existing request_id'
);
assert(
  /UPDATE\s+public\.customer_location_sms_dispatches\s+SET\s+request_id\s*=\s*v_req_id/i.test(attachOperatorBody),
  'attach_customer_location_request_to_sms_dispatch_operator attaches request_id'
);
assert(
  !attachOperatorBody.includes('SET status =') &&
    !attachOperatorBody.includes('DELETE FROM') &&
    !attachOperatorBody.includes('INSERT INTO'),
  'attach_customer_location_request_to_sms_dispatch_operator performs only request_id attachment mutation'
);


// ------------------------------------------------------------------------------
// SECTION 7: Monotonic SMS Status Progression & Monotonic Ranks (Phase 9A)
// ------------------------------------------------------------------------------
console.log('\n--- 7. Monotonic SMS Status Progression & Monotonic Ranks (Phase 9A) ---');

const monotonicRpcs = [
  'finalize_customer_location_sms_send_integration',
  'finalize_customer_location_sms_send_operator',
  'record_sms_status_callback',
];

monotonicRpcs.forEach((rpcName) => {
  const rpcBody = cleanSql.split(`FUNCTION public.${rpcName}`)[1].split('$$;')[0];

  assert(
    /WHEN\s+'reserved'\s+THEN\s+0/i.test(rpcBody) &&
      /WHEN\s+'accepted'\s+THEN\s+1/i.test(rpcBody) &&
      /WHEN\s+'queued'\s+THEN\s+2/i.test(rpcBody) &&
      /WHEN\s+'sending'\s+THEN\s+3/i.test(rpcBody) &&
      /WHEN\s+'sent'\s+THEN\s+4/i.test(rpcBody) &&
      /WHEN\s+'delivered'\s+THEN\s+100/i.test(rpcBody) &&
      /WHEN\s+'undelivered'\s+THEN\s+100/i.test(rpcBody) &&
      /WHEN\s+'failed'\s+THEN\s+100/i.test(rpcBody),
    `${rpcName} implements the exact monotonic rank hierarchy`
  );

  assert(
    rpcBody.includes('v_current_rank = 100'),
    `${rpcName} protects terminal status from being overwritten or regressed`
  );
  assert(
    (rpcBody.includes('v_disp_sid') && rpcBody.includes('<> v_clean_sid')) ||
      (rpcBody.includes('v_current_sid') && rpcBody.includes('<> v_clean_sid')),
    `${rpcName} fails closed if conflicting MessageSid is received`
  );
});

// Targeted assertions for record_sms_status_callback
assert(
  callbackRpcBody.includes("'terminal_state_locked'"),
  "record_sms_status_callback returns reason 'terminal_state_locked' for locked terminal states"
);
assert(
  callbackRpcBody.includes("'duplicate_status'"),
  "record_sms_status_callback returns reason 'duplicate_status' on same-status callback"
);
assert(
  callbackRpcBody.includes("'older_state_ignored'"),
  "record_sms_status_callback returns reason 'older_state_ignored' on older rank callback"
);
assert(
  callbackRpcBody.includes('IF v_current_sid IS NULL THEN\n    UPDATE public.customer_location_sms_dispatches\n    SET provider_message_sid = v_clean_sid') ||
    (callbackRpcBody.includes('v_current_sid IS NULL') && callbackRpcBody.includes('SET provider_message_sid = v_clean_sid')),
  'record_sms_status_callback can attach missing stored provider_message_sid'
);

const rankCheckPos = callbackRpcBody.indexOf('v_new_rank < v_current_rank');
const statusMutatePos = callbackRpcBody.indexOf('SET status = v_clean_status');
assert(
  rankCheckPos >= 0 && statusMutatePos >= 0 && rankCheckPos < statusMutatePos,
  'record_sms_status_callback mutates dispatch status only AFTER rank monotonicity checks'
);

assert(
  callbackRpcBody.includes('v_delivered_event_exists') && callbackRpcBody.includes("'CUSTOMER_LOCATION_SMS_DELIVERED'"),
  'record_sms_status_callback deduplicates CUSTOMER_LOCATION_SMS_DELIVERED audit event'
);
assert(
  callbackRpcBody.includes('v_failed_event_exists') && callbackRpcBody.includes("'CUSTOMER_LOCATION_SMS_FAILED'"),
  'record_sms_status_callback deduplicates CUSTOMER_LOCATION_SMS_FAILED audit event'
);

// Targeted assertions for both finalize RPCs
const finalizeIntegrationBody = cleanSql.split('FUNCTION public.finalize_customer_location_sms_send_integration')[1].split('$;')[0];
const finalizeOperatorBody = cleanSql.split('FUNCTION public.finalize_customer_location_sms_send_operator')[1].split('$;')[0];

[
  { name: 'finalize_customer_location_sms_send_integration', body: finalizeIntegrationBody },
  { name: 'finalize_customer_location_sms_send_operator', body: finalizeOperatorBody },
].forEach(({ name, body }) => {
  assert(
    body.includes("IF v_disp_status = 'failed' THEN\n      RETURN jsonb_build_object(\n        'success', true,\n        'is_duplicate', true,\n        'status', 'failed'") ||
      (body.includes("v_disp_status = 'failed'") && body.includes("'is_duplicate', true") && body.includes("'status', 'failed'")),
    `${name} failed finalization on already failed dispatch is idempotent`
  );

  assert(
    body.includes('v_disp_sid IS NOT NULL OR v_current_rank > 0') &&
      body.includes("'already_progressed_beyond_reserved'"),
    `${name} failed finalization does not overwrite if SID exists or dispatch progressed beyond reserved`
  );

  assert(
    body.includes("'reason', 'already_progressed_beyond_reserved'"),
    `${name} includes reason already_progressed_beyond_reserved`
  );

  assert(
    body.includes('v_disp_req_id IS NULL') &&
      body.includes("'Cannot finalize active SMS send without request_id attached'"),
    `${name} requires request_id attached before successful provider finalization`
  );

  assert(
    body.includes('v_disp_sid <> v_clean_sid') &&
      body.includes('RAISE EXCEPTION'),
    `${name} fails closed on conflicting MessageSid`
  );

  const terminalBlock = body.split('IF v_current_rank = 100 THEN')[1].split('IF v_current_rank >= v_new_rank')[0];
  assert(
    terminalBlock.includes("'status', v_disp_status"),
    `${name} preserves existing terminal status`
  );
  assert(
    !terminalBlock.includes('error_code = NULL') && !terminalBlock.includes('error_message = NULL'),
    `${name} does not clear terminal error_code or error_message`
  );

  assert(
    body.includes("'CUSTOMER_LOCATION_SMS_ACCEPTED'") &&
      body.includes("IF NOT v_event_exists THEN") &&
      body.includes("metadata->>'dispatch_id'"),
    `${name} deduplicates CUSTOMER_LOCATION_SMS_ACCEPTED event`
  );
});


// ------------------------------------------------------------------------------
// SECTION 8: Vapi Webhook Route & Pure Validator (Phase 9B)
// ------------------------------------------------------------------------------
console.log('\n--- 8. Vapi Webhook Route & Pure Validator (Phase 9B) ---');

const vapiRoutePath = path.join(rootDir, 'src/app/api/webhooks/vapi/route.ts');
const vapiValidatorPath = path.join(rootDir, 'src/lib/telephony/vapi-validator.ts');
const voiceActionsPath = path.join(rootDir, 'src/lib/telephony/voice-actions.ts');

assert(fs.existsSync(vapiRoutePath), 'Vapi webhook route.ts exists');
assert(fs.existsSync(vapiValidatorPath), 'vapi-validator.ts exists');
assert(fs.existsSync(voiceActionsPath), 'voice-actions.ts exists');

const vapiRouteCode = stripCodeComments(fs.readFileSync(vapiRoutePath, 'utf8'));
const vapiValidatorCode = stripCodeComments(fs.readFileSync(vapiValidatorPath, 'utf8'));
const voiceActionsCode = stripCodeComments(fs.readFileSync(voiceActionsPath, 'utf8'));

// Secret check
assert(
  vapiRouteCode.includes('const expectedSecret = process.env.VAPI_WEBHOOK_SECRET') &&
    vapiRouteCode.includes('validateVapiBearerToken(authHeader, expectedSecret)') &&
    vapiValidatorCode.includes('if (!authHeader || !expectedSecret)') &&
    vapiValidatorCode.includes('const trimmedSecret = expectedSecret.trim()') &&
    vapiValidatorCode.includes('if (!providedToken || !trimmedSecret)'),
  'Vapi route and validator check VAPI_WEBHOOK_SECRET for nonblank'
);
assert(
  vapiRouteCode.indexOf('validateVapiBearerToken') < vapiRouteCode.indexOf('request.json()'),
  'Vapi route validates Bearer token BEFORE reading/parsing JSON body'
);
assert(
  vapiRouteCode.includes("new Response('Unauthorized', { status: 401 })"),
  'Vapi route returns 401 on missing or invalid Bearer authentication'
);
assert(
  vapiRouteCode.includes('toolCalls.length === 0'),
  'Vapi route rejects empty tool calls with 400 Bad Request'
);

// Duplicate toolCall IDs detected before execution loop begins
const dupCheckPos = vapiRouteCode.indexOf('seenIds.has(toolCall.id)');
const execLoopPos = vapiRouteCode.lastIndexOf('for (const toolCall of toolCalls)');
assert(
  dupCheckPos >= 0 && execLoopPos >= 0 && dupCheckPos < execLoopPos,
  'Vapi route validates duplicate toolCall IDs before the tool execution loop begins'
);


assert(
  vapiRouteCode.includes("toolName !== 'create_incident'"),
  'Vapi route rejects any tool name other than create_incident'
);
assert(
  vapiRouteCode.includes('try {') && vapiRouteCode.includes('results.push('),
  'Vapi route isolates each tool call execution in its own try/catch boundary'
);

// Envelope collection precedence
assert(
  vapiValidatorCode.includes('msgObj.toolCallList') &&
    vapiValidatorCode.includes('msgObj.toolCalls') &&
    !vapiValidatorCode.includes('toolCallList.concat(toolCalls)') &&
    !vapiValidatorCode.includes('[...toolCallList, ...toolCalls]'),
  'vapi-validator enforces toolCallList as primary, toolCalls as fallback, and never concatenates both'
);
assert(
  /if\s*\(\s*Array\.isArray\s*\(\s*msgObj\.toolCallList\s*\)\s*\)\s*\{\s*rawList\s*=\s*msgObj\.toolCallList;\s*\}\s*else\s+if\s*\(\s*Array\.isArray\s*\(\s*msgObj\.toolCalls\s*\)\s*\)\s*\{\s*rawList\s*=\s*msgObj\.toolCalls;\s*\}/m.test(
    vapiValidatorCode
  ),
  'vapi-validator enforces toolCallList primary over toolCalls fallback in exact executable branching'
);

// Idempotency key exact format
assert(
  vapiValidatorCode.includes('`vapi:${callId.trim()}:${toolCallId.trim()}`'),
  'vapi-validator generates boundary idempotency key in exact format `vapi:${callId.trim()}:${toolCallId.trim()}`'
);

// Pure snake_case arguments without camelCase fallback
const requiredSnakeArgs = [
  'args.customer_name',
  'args.customer_phone',
  'args.location_address',
  'args.service_type',
  'args.priority',
  'args.vehicle_year',
  'args.notes',
  'args.vehicle_make',
  'args.vehicle_model',
  'args.vehicle_color',
  'args.vehicle_registration',
];
requiredSnakeArgs.forEach((snakeArg) => {
  assert(vapiValidatorCode.includes(snakeArg), `vapi-validator reads external arg: ${snakeArg}`);
});

const forbiddenCamelArgs = [
  'args.customerName',
  'args.customerPhone',
  'args.locationAddress',
  'args.serviceType',
  'args.vehicleYear',
  'args.vehicleMake',
  'args.vehicleModel',
  'args.vehicleColor',
  'args.vehicleRegistration',
];
forbiddenCamelArgs.forEach((camelArg) => {
  assert(!vapiValidatorCode.includes(camelArg), `vapi-validator rejects camelCase fallback: ${camelArg}`);
});

// Vehicle year validation
assert(
  vapiValidatorCode.includes("typeof rawYear !== 'number'") &&
    vapiValidatorCode.includes('!Number.isInteger(rawYear)') &&
    vapiValidatorCode.includes('!Number.isFinite(rawYear)') &&
    vapiValidatorCode.includes('rawYear < 1900 || rawYear > 2100'),
  'vapi-validator strictly validates vehicle_year as finite integer between 1900 and 2100'
);

// Voice action database isolation
const voiceActionsClean = stripCodeComments(voiceActionsCode);
const rpcCallMatches = [...voiceActionsClean.matchAll(/\.rpc\s*\(/g)];
assert(
  rpcCallMatches.length === 1,
  'voice-actions.ts contains exactly ONE executable .rpc() call'
);
assert(
  /rpc\s*\(\s*['"]create_voice_intake_incident['"]/i.test(voiceActionsClean),
  'voice-actions invokes create_voice_intake_incident RPC'
);
assert(
  !voiceActionsCode.includes("from('incidents').insert") &&
    !voiceActionsCode.includes('service_role'),
  'voice-actions performs zero direct table mutations and zero service-role client usage'
);
assert(
  voiceActionsCode.includes('payload.incident_id') &&
    voiceActionsCode.includes('payload.reference_number') &&
    voiceActionsCode.includes('payload.status') &&
    voiceActionsCode.includes('payload.is_duplicate'),
  'voice-actions runtime validates incident UUID, reference number, status, and is_duplicate flag'
);

// Voice intake formatting
const formatCode = vapiValidatorCode.split('formatVoiceIntakeToolResult')[1];
assert(
  formatCode.includes('`Incident ${ref} has been created successfully.`'),
  'formatVoiceIntakeToolResult uses real reference number for new incidents'
);
assert(
  formatCode.includes('`Incident ${ref} already exists and is currently ${status}.`'),
  'formatVoiceIntakeToolResult uses actual DB status for duplicate incidents'
);
assert(!formatCode.includes('result.incident_id'), 'formatVoiceIntakeToolResult never exposes incident_id UUID');
assert(!/sms/i.test(formatCode), 'formatVoiceIntakeToolResult never mentions SMS');

// ------------------------------------------------------------------------------
// SECTION 9: Twilio Transport Client & Signature Validator (Phase 9C)
// ------------------------------------------------------------------------------
console.log('\n--- 9. Twilio Transport Client & Signature Validator (Phase 9C) ---');

const packageJsonPath = path.join(rootDir, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
assert(
  packageJson.dependencies && packageJson.dependencies.twilio,
  'package.json includes official twilio dependency'
);
const twilioDepVersion = packageJson.dependencies.twilio;
assert(
  twilioDepVersion === '^6.1.2' || twilioDepVersion === '6.1.2',
  `Twilio version is compatible with locked 6.1.2 installation (found: ${twilioDepVersion})`
);

const twilioClientPath = path.join(rootDir, 'src/lib/telephony/twilio-client.ts');
assert(fs.existsSync(twilioClientPath), 'twilio-client.ts exists');
const rawTwilioClientCode = fs.readFileSync(twilioClientPath, 'utf8');
const twilioClientCode = stripCodeComments(rawTwilioClientCode);

assert(twilioClientCode.includes("import 'server-only'"), 'twilio-client.ts enforces server-only boundary');
assert(
  twilioClientCode.includes("import twilio from 'twilio'"),
  'twilio-client.ts imports official twilio package'
);
assert(
  twilioClientCode.includes('const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim()') &&
    twilioClientCode.includes('const authToken = process.env.TWILIO_AUTH_TOKEN?.trim()') &&
    twilioClientCode.includes('const messagingSender = process.env.TWILIO_MESSAGING_SENDER?.trim()') &&
    twilioClientCode.includes('const statusCallbackBaseUrl = process.env.TWILIO_STATUS_CALLBACK_BASE_URL?.trim()') &&
    twilioClientCode.includes('if (!accountSid)') &&
    twilioClientCode.includes('if (!authToken)') &&
    twilioClientCode.includes('if (!messagingSender)') &&
    twilioClientCode.includes('if (!statusCallbackBaseUrl)'),
  'twilio-client.ts validates that all 4 required environment variables are nonblank'
);
assert(
  !twilioClientCode.includes("messagingSender || 'MATOSROAD'") &&
    !twilioClientCode.includes("messagingSender ?? 'MATOSROAD'"),
  'twilio-client.ts has zero sender fallback'
);

// Protocol explicitly restricted to http: or https: (tested on raw code to preserve //)
assert(
  rawTwilioClientCode.includes("url.protocol !== 'http:' && url.protocol !== 'https:'"),
  'twilio-client.ts explicitly restricts callback URL protocol to http: or https:'
);
assert(
  twilioClientCode.includes('UUID_REGEX.test(cleanId)'),
  'twilio-client.ts validates dispatch ID as valid UUID'
);
assert(
  twilioClientCode.includes("url.searchParams.set('dispatch_id', cleanId)"),
  'twilio-client.ts attaches dispatch_id using URLSearchParams semantics'
);
assert(
  twilioClientCode.includes('from: config.messagingSender') &&
    twilioClientCode.includes('to: cleanPhone') &&
    twilioClientCode.includes('body: params.body') &&
    twilioClientCode.includes('statusCallback'),
  'twilio-client.ts passes required arguments into messages.create'
);
assert(
  twilioClientCode.includes('!message.sid || message.sid.trim().length === 0'),
  'twilio-client.ts requires non-empty message.sid'
);
assert(
  twilioClientCode.includes('status: message.status'),
  'twilio-client.ts returns actual provider message.status'
);
assert(
  !twilioClientCode.includes('safeMessage = err.message') &&
    !twilioClientCode.includes('throw new TwilioTransportError(err.message'),
  'twilio-client.ts does not propagate arbitrary SDK Error.message'
);
assert(
  twilioClientCode.includes("typeof rawCode === 'number'") &&
    twilioClientCode.includes('Number.isInteger(rawCode)'),
  'twilio-client.ts extracts numeric provider error code only'
);
assert(
  twilioClientCode.includes('new URL('),
  'buildTwilioStatusCallbackUrl uses new URL(...)'
);
assert(
  twilioClientCode.includes("typeof rawCode === 'string' && /^\\d{1,8}$/.test(rawCode.trim())"),
  'string provider error codes are accepted ONLY through the existing digit-only regex /^\\d{1,8}$/'
);
assert(
  !/safeCode\s*=\s*rawCode(?!\.trim\(\))/.test(twilioClientCode) &&
    !twilioClientCode.includes('safeCode = String(err') &&
    twilioClientCode.includes("safeCode = 'TWILIO_DISPATCH_ERROR'"),
  'arbitrary nonnumeric string error codes cannot become safeCode'
);
assert(
  twilioClientCode.includes("safeCode = 'TWILIO_DISPATCH_ERROR'"),
  'twilio-client.ts includes fallback TWILIO_DISPATCH_ERROR code'
);
assert(
  twilioClientCode.includes('twilio.validateRequest(authToken.trim(), signature.trim(), expectedUrl, params)'),
  'twilio-client.ts uses official twilio.validateRequest helper'
);
assert(
  twilioClientCode.includes('!signature || signature.trim().length === 0'),
  'validateTwilioWebhookSignature fails false on missing signature'
);
assert(
  twilioClientCode.includes('!authToken || authToken.trim().length === 0'),
  'validateTwilioWebhookSignature fails false on missing authToken'
);
assert(
  twilioClientCode.includes('try {\n    return twilio.validateRequest') &&
    twilioClientCode.includes('} catch {\n    return false;\n  }'),
  'validateTwilioWebhookSignature fails false if twilio.validateRequest throws'
);


// ------------------------------------------------------------------------------
// SECTION 10: Automated SMS Orchestrator (Phase 9C)
// ------------------------------------------------------------------------------
console.log('\n--- 10. Automated SMS Orchestrator (Phase 9C) ---');

const smsActionsPath = path.join(rootDir, 'src/lib/telephony/sms-actions.ts');
assert(fs.existsSync(smsActionsPath), 'sms-actions.ts exists');
const rawSmsActionsCode = fs.readFileSync(smsActionsPath, 'utf8');
const smsActionsCode = stripCodeComments(rawSmsActionsCode);

assert(smsActionsCode.includes("import 'server-only'"), 'sms-actions.ts enforces server-only boundary');
assert(smsActionsCode.includes('UUID_REGEX'), 'sms-actions.ts includes strict UUID validation');
assert(smsActionsCode.includes('E164_REGEX'), 'sms-actions.ts includes strict E.164 regex validation');
assert(
  smsActionsCode.includes('params.idempotencyKey?.trim()') &&
    smsActionsCode.includes('if (!cleanKey)'),
  'sms-actions.ts requires non-empty idempotency key'
);

// Reserve before send ordering
const reservePos = smsActionsCode.indexOf("'reserve_customer_location_sms_integration'");
const createAutoPos = smsActionsCode.indexOf("'create_automated_customer_location_request'");
const sendTwilioPos = smsActionsCode.indexOf('sendTwilioSms({');
assert(
  reservePos >= 0 && createAutoPos >= 0 && sendTwilioPos >= 0 &&
    reservePos < createAutoPos && createAutoPos < sendTwilioPos,
  'sms-actions.ts enforces exact linear order: reserve -> create token -> sendTwilioSms'
);

// Duplicate reservation halts before token creation
const dupBranchPos = smsActionsCode.indexOf('if (reservePayload.reserved === false)');
assert(
  dupBranchPos >= 0 && dupBranchPos < createAutoPos,
  'Duplicate reservation branch returns before create_automated_customer_location_request'
);
const dupReserveBlock = smsActionsCode
  .split('if (reservePayload.reserved === false)')[1]
  .split('create_automated_customer_location_request')[0];
assert(
  dupReserveBlock.includes('return {') &&
    !dupReserveBlock.includes('create_automated_customer_location_request'),
  'reservePayload.reserved === false branch contains early RETURN before create_automated_customer_location_request can execute'
);

// Duplicate response runtime validation
assert(
  smsActionsCode.includes('UUID_REGEX.test(reservePayload.dispatch_id.trim())'),
  'sms-actions.ts validates duplicate response dispatch_id UUID'
);
assert(
  smsActionsCode.includes('ALL_SMS_DISPATCH_STATUSES.has(reservePayload.existing_status as SmsDispatchStatus)'),
  'sms-actions.ts runtime validates duplicate response status against ALL_SMS_DISPATCH_STATUSES'
);
assert(
  smsActionsCode.includes('reservePayload.message_sid !== undefined') &&
    smsActionsCode.includes('reservePayload.message_sid.trim().length === 0'),
  'sms-actions.ts validates duplicate response message_sid is null/undefined or non-empty string'
);

// Automated token response validation
assert(
  smsActionsCode.includes('tokenPayload.success !== true'),
  'sms-actions.ts validates token response success flag'
);
assert(
  smsActionsCode.includes('HEX64_REGEX.test(tokenPayload.token.trim())'),
  'sms-actions.ts validates token is exactly 64 hexadecimal characters'
);
assert(
  smsActionsCode.includes('UUID_REGEX.test(tokenPayload.request_id.trim())'),
  'sms-actions.ts validates location request_id UUID'
);
assert(
  smsActionsCode.includes('Number.isNaN(new Date(tokenPayload.expires_at).getTime())'),
  'sms-actions.ts validates expiration timestamp'
);
assert(
  smsActionsCode.includes("tokenPayload.relative_path.startsWith('/customer/location/')"),
  'sms-actions.ts validates relative_path starts with /customer/location/'
);

// APP_BASE_URL absolute URL validation (raw code check to protect //)
assert(
  rawSmsActionsCode.includes("base.protocol !== 'http:' && base.protocol !== 'https:'"),
  'sms-actions.ts validates APP_BASE_URL protocol is http: or https:'
);

assert(
  smsActionsCode.includes('`Matos Roadside: Please confirm your breakdown location: ${customerUrl}`'),
  'sms-actions.ts uses exact standard SMS message text'
);
assert(smsActionsCode.includes('sendTwilioSms({'), 'sms-actions.ts sends SMS via approved sendTwilioSms');
assert(
  !smsActionsCode.includes('import twilio from') && !smsActionsCode.includes('twilio('),
  'sms-actions.ts does not directly import Twilio SDK or create client'
);

// Pre-send failure helper calls finalize with p_message_sid: null and p_status: 'failed'
assert(
  smsActionsCode.includes("p_message_sid: null") &&
    smsActionsCode.includes("p_status: 'failed'"),
  'Pre-send failure helper passes p_message_sid: null and p_status: failed'
);

// Unsupported provider status handling
const unsuppPos = smsActionsCode.indexOf("errorCode: 'UNSUPPORTED_PROVIDER_STATUS'");
const finalizePos = smsActionsCode.indexOf("'finalize_customer_location_sms_send_integration'", unsuppPos);
assert(
  unsuppPos >= 0 && finalizePos >= 0 && unsuppPos < finalizePos,
  'Unsupported provider status branch returns before normal success finalization'
);
const unsuppStatusBlock = smsActionsCode
  .split('if (!PROVIDER_SMS_DISPATCH_STATUSES.has(twilioStatus as SmsDispatchStatus))')[1]
  .split('finalize_customer_location_sms_send_integration')[0];
assert(
  unsuppStatusBlock.includes('return {') &&
    unsuppStatusBlock.includes("errorCode: 'UNSUPPORTED_PROVIDER_STATUS'") &&
    !unsuppStatusBlock.includes('finalize_customer_location_sms_send_integration'),
  'Unsupported provider status branch extracts cleanly and contains early RETURN before normal finalization'
);


// Success finalization passes actual twilioStatus
assert(
  smsActionsCode.includes('p_status: twilioStatus'),
  'sms-actions.ts passes actual twilioStatus into finalization RPC'
);
assert(
  smsActionsCode.includes('PROVIDER_SMS_DISPATCH_STATUSES.has(finalPayload.status as SmsDispatchStatus)'),
  'sms-actions.ts validates authoritative status returned from finalization RPC'
);
assert(
  smsActionsCode.includes("twilioStatus !== 'failed'") &&
    smsActionsCode.includes('finalPayload.message_sid.trim() !== messageSid'),
  'sms-actions.ts enforces MessageSid consistency for non-failed finalization'
);
assert(
  smsActionsCode.includes("finalPayload.message_sid !== undefined") &&
    smsActionsCode.includes("finalPayload.message_sid !== null") &&
    smsActionsCode.includes("finalPayload.message_sid.trim() !== messageSid"),
  'sms-actions.ts permits missing message_sid on failed finalization branch'
);
assert(
  smsActionsCode.includes("typeof finalPayload.is_duplicate !== 'boolean'"),
  'sms-actions.ts runtime validates is_duplicate flag'
);



// ------------------------------------------------------------------------------
// SECTION 11: Twilio Status Callback Webhook Route (Phase 9C)
// ------------------------------------------------------------------------------
console.log('\n--- 11. Twilio Status Callback Webhook Route (Phase 9C) ---');

const twilioStatusRoutePath = path.join(rootDir, 'src/app/api/webhooks/twilio/status/route.ts');
assert(fs.existsSync(twilioStatusRoutePath), 'Twilio status callback route.ts exists');
const rawTwilioStatusRouteCode = fs.readFileSync(twilioStatusRoutePath, 'utf8');
const twilioStatusRouteCode = stripCodeComments(rawTwilioStatusRouteCode);

assert(
  twilioStatusRouteCode.includes('UUID_REGEX.test(rawId)'),
  'Twilio callback route validates dispatch_id query parameter with UUID_REGEX'
);
assert(
  twilioStatusRouteCode.includes('await request.formData()'),
  'Twilio callback route parses request.formData()'
);
assert(
  /formData\.forEach\(\(value,\s*key\)\s*=>\s*\{[\s\S]*?typeof\s+value\s*===\s*'string'[\s\S]*?formParams\[key\]\s*=\s*value/m.test(
    twilioStatusRouteCode
  ),
  'Twilio callback route iterates formData and collects all string entries into formParams'
);
assert(
  twilioStatusRouteCode.includes('buildTwilioStatusCallbackUrl(statusCallbackBaseUrl, dispatchId)'),
  'Twilio callback route builds expected URL from configured base URL'
);
assert(
  !twilioStatusRouteCode.includes('x-forwarded-host') &&
    !twilioStatusRouteCode.includes('x-forwarded-proto') &&
    !twilioStatusRouteCode.includes("headers.get('host')"),
  'Twilio callback route does not trust Host or forwarded headers for expected signature URL'
);

assert(
  twilioStatusRouteCode.includes('process.env.TWILIO_AUTH_TOKEN?.trim()'),
  'Twilio callback route reads TWILIO_AUTH_TOKEN'
);
assert(
  twilioStatusRouteCode.includes('process.env.TWILIO_STATUS_CALLBACK_BASE_URL?.trim()'),
  'Twilio callback route reads TWILIO_STATUS_CALLBACK_BASE_URL'
);
assert(
  twilioStatusRouteCode.includes('process.env.MATOS_TWILIO_DB_SECRET?.trim()'),
  'Twilio callback route reads MATOS_TWILIO_DB_SECRET'
);
assert(
  twilioStatusRouteCode.includes('if (!authToken || !statusCallbackBaseUrl || !twilioDbSecret)') &&
    twilioStatusRouteCode.includes("new Response('Configuration Error', { status: 500 })"),
  'Twilio callback route fails configuration if any required environment variable is missing'
);
assert(
  twilioStatusRouteCode.includes("request.headers.get('x-twilio-signature')"),
  'Twilio callback route reads x-twilio-signature header'
);
assert(
  twilioStatusRouteCode.includes('if (!signature)') &&
    twilioStatusRouteCode.includes("new Response('Forbidden', { status: 403 })"),
  'Twilio callback route returns 403 if signature is missing'
);

const sigPos = twilioStatusRouteCode.indexOf('validateTwilioWebhookSignature');
const dbPos = twilioStatusRouteCode.indexOf("rpc('record_sms_status_callback'");
const clientPos = twilioStatusRouteCode.indexOf('createClient()');
assert(
  sigPos >= 0 && clientPos >= 0 && sigPos < clientPos,
  'validateTwilioWebhookSignature occurs BEFORE createClient()'
);
assert(
  sigPos >= 0 && dbPos >= 0 && sigPos < dbPos,
  'validateTwilioWebhookSignature occurs BEFORE record_sms_status_callback RPC'
);

assert(
  twilioStatusRouteCode.includes('!messageSid || messageSid.length === 0'),
  'Twilio callback route requires non-empty MessageSid'
);
assert(
  twilioStatusRouteCode.includes('!messageStatus ||') &&
    twilioStatusRouteCode.includes('!VALID_SMS_DISPATCH_STATUSES.has(messageStatus as SmsDispatchStatus)'),
  'Twilio callback route explicitly rejects missing messageStatus'
);

const unsuppRoutePos = twilioStatusRouteCode.indexOf('!VALID_SMS_DISPATCH_STATUSES.has(messageStatus as SmsDispatchStatus)');
assert(
  unsuppRoutePos >= 0 && clientPos >= 0 && dbPos >= 0 && unsuppRoutePos < clientPos && unsuppRoutePos < dbPos,
  'Twilio callback route returns 400 on unsupported status before createClient and before record_sms_status_callback RPC'
);

const dispatchUuidPos = twilioStatusRouteCode.indexOf('UUID_REGEX.test(rawId)');
assert(
  dispatchUuidPos >= 0 && clientPos >= 0 && dbPos >= 0 && dispatchUuidPos < clientPos && dispatchUuidPos < dbPos,
  'dispatch_id UUID validation remains before DB access'
);

assert(
  twilioStatusRouteCode.includes('p_integration_secret: twilioDbSecret'),
  'Twilio callback route passes MATOS_TWILIO_DB_SECRET as p_integration_secret'
);
assert(
  twilioStatusRouteCode.includes("rpc('record_sms_status_callback'") &&
    !twilioStatusRouteCode.includes('.insert') &&
    !twilioStatusRouteCode.includes('.update') &&
    !twilioStatusRouteCode.includes('.delete') &&
    !twilioStatusRouteCode.includes('.upsert'),
  'ONLY record_sms_status_callback is used for callback DB mutation'
);
assert(
  !twilioStatusRouteCode.includes('SUPABASE_SERVICE_ROLE_KEY') &&
    !twilioStatusRouteCode.includes('service_role'),
  'Twilio callback route has zero service-role usage'
);
assert(
  twilioStatusRouteCode.includes('payload.success !== true'),
  'Twilio callback route verifies payload.success === true'
);
assert(
  twilioStatusRouteCode.includes('new Response(null, { status: 204 })'),
  'Twilio callback route returns 204 No Content upon success or valid no-op'
);


// ------------------------------------------------------------------------------
// SECTION 12: Environment Variables Contract (.env.example & Server Code)
// ------------------------------------------------------------------------------
console.log('\n--- 12. Environment Variables Contract (.env.example & Server Code) ---');

const envExamplePath = path.join(rootDir, '.env.example');
assert(fs.existsSync(envExamplePath), '.env.example exists');
const envExampleContent = fs.readFileSync(envExamplePath, 'utf8');

const requiredEnvVars = [
  'VAPI_WEBHOOK_SECRET',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_MESSAGING_SENDER',
  'APP_BASE_URL',
  'TWILIO_STATUS_CALLBACK_BASE_URL',
  'MATOS_TWILIO_DB_SECRET',
];

requiredEnvVars.forEach((v) => {
  assert(envExampleContent.includes(`${v}=`), `.env.example contains exact variable ${v}`);
  assert(!envExampleContent.includes(`NEXT_PUBLIC_${v}`), `${v} is NOT exposed as NEXT_PUBLIC_`);
});

const staleEnvVars = [
  'TWILIO_STATUS_CALLBACK_URL',
  'MATOS_INTERNAL_INTEGRATION_SECRET',
  'TWILIO_PHONE_NUMBER',
];

staleEnvVars.forEach((v) => {
  assert(!envExampleContent.includes(v), `.env.example does not contain stale variable name ${v}`);
});

// Verify no Phase 9 production code references stale names or exposes secrets with NEXT_PUBLIC_
const phase9ServerFiles = [
  'src/app/api/webhooks/vapi/route.ts',
  'src/lib/telephony/vapi-validator.ts',
  'src/lib/telephony/voice-actions.ts',
  'src/lib/telephony/twilio-client.ts',
  'src/lib/telephony/sms-actions.ts',
  'src/app/api/webhooks/twilio/status/route.ts',
  'src/lib/customer/location-actions.ts',
  'src/components/incidents/customer-location-link-control.tsx',
  'src/app/(operator)/incidents/[id]/page.tsx',
];

phase9ServerFiles.forEach((rel) => {
  const code = stripCodeComments(fs.readFileSync(path.join(rootDir, rel), 'utf8'));
  staleEnvVars.forEach((stale) => {
    assert(!code.includes(stale), `${rel} does not reference stale env var ${stale}`);
  });

  assert(!code.includes('NEXT_PUBLIC_TWILIO_'), `${rel} does not expose NEXT_PUBLIC_TWILIO_*`);
  assert(!code.includes('NEXT_PUBLIC_VAPI_'), `${rel} does not expose NEXT_PUBLIC_VAPI_*`);
  assert(!code.includes('NEXT_PUBLIC_MATOS_TWILIO_DB_SECRET'), `${rel} does not expose NEXT_PUBLIC_MATOS_TWILIO_DB_SECRET`);
});

// ------------------------------------------------------------------------------
// SECTION 13: Operator Location SMS Server Action (Phase 9D)
// ------------------------------------------------------------------------------
console.log('\n--- 13. Operator Location SMS Server Action (Phase 9D) ---');

const locationActionsPath = path.join(rootDir, 'src/lib/customer/location-actions.ts');
assert(fs.existsSync(locationActionsPath), 'location-actions.ts exists');
const rawLocationActionsCode = fs.readFileSync(locationActionsPath, 'utf8');
const locationActionsCode = stripCodeComments(rawLocationActionsCode);

assert(
  locationActionsCode.includes('export async function createCustomerLocationRequest'),
  'location-actions.ts preserves createCustomerLocationRequest'
);
assert(
  locationActionsCode.includes('export async function getCustomerLocationRequestStatus'),
  'location-actions.ts preserves getCustomerLocationRequestStatus'
);
assert(
  locationActionsCode.includes('export async function submitCustomerLocation'),
  'location-actions.ts preserves submitCustomerLocation'
);
assert(
  locationActionsCode.includes('export async function sendCustomerLocationSmsAction'),
  'location-actions.ts exports sendCustomerLocationSmsAction'
);

const actionBody = locationActionsCode.split('export async function sendCustomerLocationSmsAction')[1];

// Input validations
assert(
  actionBody.includes('UUID_REGEX.test(cleanIncidentId)'),
  'sendCustomerLocationSmsAction validates incident ID with UUID_REGEX'
);
assert(
  actionBody.includes('E164_REGEX.test(cleanPhone)'),
  'sendCustomerLocationSmsAction validates phone with E164_REGEX'
);
assert(
  actionBody.includes('cleanKey.length > 255'),
  'sendCustomerLocationSmsAction validates idempotency key boundary'
);

// High-level source ordering check
const opReserveIdx = actionBody.indexOf("'reserve_customer_location_sms_operator'");
const opCreateTokenIdx = actionBody.indexOf("'create_customer_location_request'");
const opAttachIdx = actionBody.indexOf("'attach_customer_location_request_to_sms_dispatch_operator'");
const opBuildUrlIdx = actionBody.indexOf('buildCustomerLocationUrl(');
const opSendTwilioIdx = actionBody.indexOf('sendTwilioSms(');
const opFinalizeIdx = actionBody.indexOf("'finalize_customer_location_sms_send_operator'");

assert(
  opReserveIdx >= 0 && opCreateTokenIdx >= 0 && opAttachIdx >= 0 &&
    opBuildUrlIdx >= 0 && opSendTwilioIdx >= 0 && opFinalizeIdx >= 0 &&
    opReserveIdx < opCreateTokenIdx &&
    opCreateTokenIdx < opAttachIdx &&
    opAttachIdx < opBuildUrlIdx &&
    opBuildUrlIdx < opSendTwilioIdx &&
    opSendTwilioIdx < opFinalizeIdx,
  'Operator action enforces exact linear order: reserve -> create token -> attach -> build URL -> sendTwilioSms -> finalize'
);

// Duplicate check halts before token creation
const opDupCheckIdx = actionBody.indexOf('reservePayload.reserved === false');
assert(
  opDupCheckIdx >= 0 && opDupCheckIdx < opCreateTokenIdx,
  'Duplicate reservation check halts and returns before create_customer_location_request is invoked'
);
const opDupReserveBlock = locationActionsCode
  .split('if (reservePayload.reserved === false)')[1]
  .split('create_customer_location_request')[0];
assert(
  opDupReserveBlock.includes('return {') &&
    !opDupReserveBlock.includes('create_customer_location_request'),
  'Operator reservePayload.reserved === false branch contains early RETURN before token creation'
);

// Duplicate response validation
assert(
  actionBody.includes('UUID_REGEX.test(reservePayload.dispatch_id.trim())'),
  'Operator action validates duplicate dispatch_id UUID'
);
assert(
  actionBody.includes('ALL_SMS_DISPATCH_STATUSES.has(reservePayload.existing_status as SmsDispatchStatus)'),
  'Operator action validates duplicate status against ALL_SMS_DISPATCH_STATUSES'
);
assert(
  actionBody.includes('reservePayload.message_sid !== undefined') &&
    actionBody.includes('reservePayload.message_sid.trim().length === 0'),
  'Operator action validates duplicate message_sid is null/undefined or non-empty string'
);

// Token and path checks
assert(
  actionBody.includes('TOKEN_HEX_REGEX.test(tokenPayload.token.trim())'),
  'Operator action validates token is 64 hex characters'
);
assert(
  actionBody.includes('Number.isNaN(new Date(tokenPayload.expires_at).getTime())'),
  'Operator action validates expiration timestamp'
);
assert(
  actionBody.includes('tokenPayload.relative_path !== expectedRelativePath') &&
    actionBody.includes('`/customer/location/${token}`'),
  'Operator action requires relative_path to equal /customer/location/<token> exactly'
);

// Attach response validation
assert(
  actionBody.includes('attachPayload.success !== true ||\n    typeof attachPayload.request_id !== \'string\' ||\n    !UUID_REGEX.test(attachPayload.request_id.trim())') ||
    (actionBody.includes('attachPayload.success !== true') && actionBody.includes('!UUID_REGEX.test(attachPayload.request_id.trim())')),
  'Operator action validates attach RPC response success and request_id UUID'
);

// APP_BASE_URL validation (raw code check to protect //)
assert(
  rawLocationActionsCode.includes("base.protocol !== 'http:' && base.protocol !== 'https:'"),
  'location-actions.ts validates APP_BASE_URL protocol is http: or https:'
);

assert(
  actionBody.includes('`Matos Roadside: Please confirm your breakdown location: ${customerUrl}`'),
  'Operator action formats standard SMS message body'
);
assert(
  actionBody.includes('sendTwilioSms({'),
  'Operator action uses approved sendTwilioSms transport'
);
assert(
  !locationActionsCode.includes('import twilio from') && !locationActionsCode.includes('twilio('),
  'location-actions.ts has no direct Twilio client creation or import'
);

// Pre-send failure helper
assert(
  locationActionsCode.includes("finalizeOperatorFailedDispatch") &&
    locationActionsCode.includes("p_message_sid: null") &&
    locationActionsCode.includes("p_status: 'failed'"),
  'Operator pre-send failure helper passes p_message_sid: null and p_status: failed to finalize_customer_location_sms_send_operator'
);

// Unsupported status returns before finalization
const opUnsuppPos = actionBody.indexOf("errorCode: 'UNSUPPORTED_PROVIDER_STATUS'");
assert(
  opUnsuppPos >= 0 && opFinalizeIdx >= 0 && opUnsuppPos < opFinalizeIdx,
  'Operator unsupported status branch returns without calling normal finalization'
);
const opUnsuppBlock = locationActionsCode
  .split('if (!PROVIDER_SMS_DISPATCH_STATUSES.has(twilioStatus as SmsDispatchStatus))')[1]
  .split('finalize_customer_location_sms_send_operator')[0];
assert(
  opUnsuppBlock.includes('return {') &&
    opUnsuppBlock.includes("errorCode: 'UNSUPPORTED_PROVIDER_STATUS'") &&
    !opUnsuppBlock.includes('finalize_customer_location_sms_send_operator'),
  'Operator UNSUPPORTED_PROVIDER_STATUS branch extracts cleanly and contains early RETURN before normal finalization'
);

// Finalization passes twilioStatus
assert(
  actionBody.includes('p_status: twilioStatus'),
  'Operator finalization passes actual twilioStatus'
);
assert(
  actionBody.includes('PROVIDER_SMS_DISPATCH_STATUSES.has(finalPayload.status as SmsDispatchStatus)'),
  'Operator finalization validates authoritative DB status'
);
assert(
  actionBody.includes("twilioStatus !== 'failed'") &&
    actionBody.includes('finalPayload.message_sid.trim() !== messageSid'),
  'Operator finalization validates MessageSid consistency'
);
assert(
  actionBody.includes('finalPayload.message_sid !== undefined') &&
    actionBody.includes('finalPayload.message_sid !== null') &&
    actionBody.includes('finalPayload.message_sid.trim() !== messageSid'),
  'Operator finalization permits omitted message_sid on failed branch'
);
assert(
  actionBody.includes("typeof finalPayload.is_duplicate !== 'boolean'"),
  'Operator finalization validates is_duplicate boolean'
);


// Result secrecy: SendCustomerLocationSmsActionResult interface definition does not expose token/url/secret
const resultInterfaceBlock = locationActionsCode
  .split('export interface SendCustomerLocationSmsActionResult')[1]
  .split('}')[0];

const secretFields = ['token', 'url', 'relativePath', 'customerUrl', 'integrationSecret'];
secretFields.forEach((field) => {
  const fieldRegex = new RegExp(`^\\s*${field}\\s*\\??:`, 'm');
  assert(!fieldRegex.test(resultInterfaceBlock), `SendCustomerLocationSmsActionResult does NOT leak: ${field}`);
});

// ------------------------------------------------------------------------------
// SECTION 14: Operator Customer Location Link & SMS Client UI (Phase 9D)
// ------------------------------------------------------------------------------
console.log('\n--- 14. Operator Customer Location Link & SMS Client UI (Phase 9D) ---');

const linkControlPath = path.join(rootDir, 'src/components/incidents/customer-location-link-control.tsx');
assert(fs.existsSync(linkControlPath), 'customer-location-link-control.tsx exists');
const linkControlCode = stripCodeComments(fs.readFileSync(linkControlPath, 'utf8'));

assert(
  linkControlCode.includes("import { createClient } from '@/lib/supabase/client';"),
  'CustomerLocationLinkControl imports browser Supabase client'
);
assert(
  linkControlCode.includes('customerPhone: string'),
  'CustomerLocationLinkControlProps includes customerPhone'
);

// Initial query assertions
const initialQueryBlock = linkControlCode
  .split('async function loadInitialDispatch')[1]
  .split('.maybeSingle()')[0];

assert(
  initialQueryBlock.includes(".eq('incident_id', incidentId)"),
  'Initial dispatch query filters by incident_id'
);
assert(
  initialQueryBlock.includes(".order('created_at', { ascending: false })"),
  'Initial dispatch query orders created_at descending'
);
assert(
  initialQueryBlock.includes('.limit(1)'),
  'Initial dispatch query limits to 1 row'
);
assert(
  !initialQueryBlock.includes('error_message'),
  'Initial dispatch query select does NOT include raw error_message'
);

// Active dispatch pinning
assert(
  linkControlCode.includes('activeDispatchIdRef.current = result.dispatchId'),
  'CustomerLocationLinkControl pins returned dispatchId as active'
);
assert(
  linkControlCode.includes('loaded.id !== activeDispatchIdRef.current') &&
    linkControlCode.includes('newRow.id !== activeDispatchIdRef.current'),
  'CustomerLocationLinkControl ignores unrelated dispatches while pinned send is active'
);

// No fabricated database timestamps
assert(
  !linkControlCode.includes('created_at: new Date()') &&
    !linkControlCode.includes('updated_at: new Date()'),
  'CustomerLocationLinkControl never fabricates created_at or updated_at database timestamps'
);

// No fallback default status
assert(
  !linkControlCode.includes("result.status || 'reserved'") &&
    !linkControlCode.includes("result.status ?? 'reserved'"),
  'CustomerLocationLinkControl has zero status fallback to reserved'
);

// Complete isCompleteDispatchState function
assert(
  linkControlCode.includes('function isCompleteDispatchState'),
  'CustomerLocationLinkControl defines isCompleteDispatchState'
);
const validatorFnBlock = linkControlCode
  .split('function isCompleteDispatchState')[1]
  .split('function getStatusBadgeConfig')[0];

assert(
  validatorFnBlock.includes('d.id') &&
    validatorFnBlock.includes('d.incident_id') &&
    validatorFnBlock.includes('d.recipient_phone') &&
    validatorFnBlock.includes('d.status') &&
    validatorFnBlock.includes('isValidIsoDate(d.created_at)') &&
    validatorFnBlock.includes('isValidIsoDate(d.updated_at)') &&
    validatorFnBlock.includes('d.provider_message_sid') &&
    validatorFnBlock.includes('d.error_code'),
  'isCompleteDispatchState verifies all required fields and types'
);
assert(
  validatorFnBlock.includes("typeof d.id !== 'string'") ||
    validatorFnBlock.includes("typeof d.id === 'string'"),
  "isCompleteDispatchState runtime validates typeof d.id === 'string'"
);
assert(
  validatorFnBlock.includes("typeof d.incident_id !== 'string'") ||
    validatorFnBlock.includes("typeof d.incident_id === 'string'"),
  "isCompleteDispatchState runtime validates typeof d.incident_id === 'string'"
);
assert(
  validatorFnBlock.includes("typeof d.recipient_phone !== 'string'") ||
    validatorFnBlock.includes("typeof d.recipient_phone === 'string'"),
  "isCompleteDispatchState runtime validates typeof d.recipient_phone === 'string'"
);
assert(
  validatorFnBlock.includes("typeof d.status !== 'string'") ||
    validatorFnBlock.includes("typeof d.status === 'string'"),
  "isCompleteDispatchState runtime validates typeof d.status === 'string'"
);
assert(
  validatorFnBlock.includes('d.provider_message_sid') &&
    validatorFnBlock.includes("typeof d.provider_message_sid !== 'string'"),
  'isCompleteDispatchState validates nullable-string provider_message_sid'
);
assert(
  validatorFnBlock.includes('d.error_code') &&
    validatorFnBlock.includes("typeof d.error_code !== 'string'"),
  'isCompleteDispatchState validates nullable-string error_code'
);
assert(
  validatorFnBlock.includes('isValidIsoDate(d.created_at)') &&
    validatorFnBlock.includes('isValidIsoDate(d.updated_at)'),
  'isCompleteDispatchState validates created_at and updated_at go through isValidIsoDate'
);

// Same-ID post-send SELECT regression protection
assert(
  linkControlCode.includes('new Date(prev.updated_at).getTime() > new Date(loaded.updated_at).getTime()'),
  'CustomerLocationLinkControl prevents post-send SELECT from regressing newer same-ID Realtime state'
);

// Manual link clear on reserved === true
const reservedClearBlock = linkControlCode
  .split('if (result.reserved === true)')[1]
  .split('if (result.dispatchId)')[0];

assert(
  reservedClearBlock.includes('setGeneratedUrl(null)') &&
    reservedClearBlock.includes('setExpiresAt(null)') &&
    reservedClearBlock.includes('setIsCopied(false)'),
  'result.reserved === true clears generatedUrl, expiresAt, and isCopied'
);
assert(
  !linkControlCode.includes('if (result.reserved === false) {\n        setGeneratedUrl(null)'),
  'result.reserved === false (duplicate) does NOT clear manual link display'
);

// Terminal gating
assert(
  linkControlCode.includes('if (isGenerating || isTerminal) return;') &&
    linkControlCode.includes('if (inFlightRef.current || isSendingSms || isTerminal) return;'),
  'Terminal gating guards both manual link generation and SMS dispatch'
);

// Realtime cleanup and zero setInterval
assert(
  linkControlCode.includes('supabase.removeChannel(channel)') ||
    linkControlCode.includes('removeChannel'),
  'CustomerLocationLinkControl cleans up Realtime channel on unmount'
);
assert(!linkControlCode.includes('setInterval'), 'Zero polling (setInterval) in CustomerLocationLinkControl');

// Preserved Link Controls & Copy flow
assert(
  linkControlCode.includes('const handleGenerateLink = async () => {') ||
    linkControlCode.includes('handleGenerateLink'),
  'CustomerLocationLinkControl preserves handleGenerateLink'
);
assert(
  linkControlCode.includes('createCustomerLocationRequest(incidentId)'),
  'CustomerLocationLinkControl preserves createCustomerLocationRequest(incidentId)'
);
assert(
  linkControlCode.includes('const handleCopyLink = async () => {') ||
    linkControlCode.includes('handleCopyLink'),
  'CustomerLocationLinkControl preserves handleCopyLink'
);
assert(
  linkControlCode.includes('navigator.clipboard.writeText(generatedUrl)'),
  'CustomerLocationLinkControl preserves navigator.clipboard.writeText(generatedUrl)'
);
assert(
  linkControlCode.includes("'Copy Link'"),
  "CustomerLocationLinkControl preserves rendered 'Copy Link'"
);
assert(
  linkControlCode.includes('Expires: {new Date(expiresAt).toLocaleTimeString'),
  'CustomerLocationLinkControl preserves expiresAt display'
);

// Preserved SMS Input & In-flight handling
assert(
  linkControlCode.includes("useState(customerPhone || '')"),
  "CustomerLocationLinkControl preserves useState(customerPhone || '')"
);
assert(
  linkControlCode.includes('setSmsRecipient(e.target.value)'),
  'CustomerLocationLinkControl preserves setSmsRecipient(e.target.value)'
);
assert(
  linkControlCode.includes('value={smsRecipient}'),
  'CustomerLocationLinkControl preserves input value={smsRecipient}'
);
assert(
  linkControlCode.includes('disabled={isSendingSms || isTerminal}'),
  'CustomerLocationLinkControl preserves input disabled by isSendingSms || isTerminal'
);
assert(
  linkControlCode.includes('onClick={handleSendSms}'),
  'CustomerLocationLinkControl preserves send button calls handleSendSms'
);
assert(
  linkControlCode.includes('disabled={isSendingSms || isTerminal || !smsRecipient.trim()}'),
  'CustomerLocationLinkControl preserves send button disabled while isSendingSms / terminal'
);
assert(
  linkControlCode.includes('crypto.randomUUID()'),
  'CustomerLocationLinkControl preserves crypto.randomUUID()'
);
const inFlightSetPos = linkControlCode.indexOf('inFlightRef.current = true');
const sendActionCallPos = linkControlCode.indexOf('await sendCustomerLocationSmsAction(');
assert(
  inFlightSetPos >= 0 && sendActionCallPos >= 0 && inFlightSetPos < sendActionCallPos,
  'inFlightRef.current = true occurs BEFORE await sendCustomerLocationSmsAction'
);
assert(
  linkControlCode.includes('inFlightRef.current = false;'),
  'finally block resets inFlightRef.current = false'
);

// Realtime preservation
assert(
  linkControlCode.includes("table: 'customer_location_sms_dispatches'"),
  'Realtime table is customer_location_sms_dispatches'
);
assert(
  linkControlCode.includes('filter: `incident_id=eq.${incidentId}`'),
  'Realtime filter is exactly incident_id=eq.${incidentId}'
);

// Badge semantics mapping
const badgeFnBlock = linkControlCode
  .split('function getStatusBadgeConfig')[1]
  .split('export function CustomerLocationLinkControl')[0];

const expectedBadgePairs = [
  { status: 'reserved', label: 'Reserved' },
  { status: 'accepted', label: 'Accepted by provider' },
  { status: 'queued', label: 'Queued' },
  { status: 'sending', label: 'Sending' },
  { status: 'sent', label: 'Sent' },
  { status: 'delivered', label: 'Delivered' },
  { status: 'undelivered', label: 'Undelivered' },
  { status: 'failed', label: 'Failed' },
];

expectedBadgePairs.forEach(({ status, label }) => {
  const caseRegex = new RegExp(`case\\s+'${status}':\\s*return\\s*\\{[^}]*label:\\s*'${label}'`, 's');
  assert(caseRegex.test(badgeFnBlock), `getStatusBadgeConfig maps '${status}' to exact truthful label '${label}'`);
});

// Prove 'Delivered' is associated ONLY with case 'delivered'
const deliveredMatches = [...badgeFnBlock.matchAll(/label:\s*'Delivered'/g)];
assert(
  deliveredMatches.length === 1 && badgeFnBlock.includes("case 'delivered':\n      return { label: 'Delivered'"),
  "The label 'Delivered' is associated solely with case 'delivered'"
);

// Error label and raw error_message protection
assert(
  linkControlCode.includes('Error Code: {dispatch.error_code}'),
  "CustomerLocationLinkControl renders error code with label 'Error Code:'"
);
assert(
  !linkControlCode.includes('Provider Error Code:'),
  "CustomerLocationLinkControl does NOT use label 'Provider Error Code:'"
);
assert(
  !linkControlCode.includes('dispatch.error_message'),
  'CustomerLocationLinkControl never renders raw database dispatch.error_message'
);

// ------------------------------------------------------------------------------
// SECTION 15: Operator Incident Page Wiring (Phase 9D)
// ------------------------------------------------------------------------------
console.log('\n--- 15. Operator Incident Page Wiring (Phase 9D) ---');

const incidentPagePath = path.join(rootDir, 'src/app/(operator)/incidents/[id]/page.tsx');
assert(fs.existsSync(incidentPagePath), 'incident detail page.tsx exists');
const incidentPageCode = stripCodeComments(fs.readFileSync(incidentPagePath, 'utf8'));

assert(
  incidentPageCode.includes('CustomerLocationLinkControl') &&
    incidentPageCode.includes('incidentId={incident.id}') &&
    incidentPageCode.includes('incidentStatus={incident.status}') &&
    incidentPageCode.includes('customerPhone={incident.customer_phone}'),
  'Incident detail page passes incident.id, incident.status, and incident.customer_phone to CustomerLocationLinkControl'
);

// ------------------------------------------------------------------------------
// SECTION 16: Zero Service-Role & Zero Direct Mutation Invariants
// ------------------------------------------------------------------------------
console.log('\n--- 16. Zero Service-Role & Zero Direct Mutation Invariants ---');

const protectedTables = [
  'incidents',
  'customer_location_requests',
  'customer_location_sms_dispatches',
  'organization_integrations',
  'intake_idempotency_keys',
];

phase9ServerFiles.forEach((relPath) => {
  const fullPath = path.join(rootDir, relPath);
  const code = stripCodeComments(fs.readFileSync(fullPath, 'utf8'));

  assert(
    !code.includes('SUPABASE_SERVICE_ROLE_KEY'),
    `${relPath} does not reference SUPABASE_SERVICE_ROLE_KEY`
  );
  assert(
    !code.includes('service_role'),
    `${relPath} contains zero executable service_role`
  );

  protectedTables.forEach((table) => {
    // Only check write mutations (.insert, .update, .delete, .upsert)
    const directMutationRegex = new RegExp(`\\.from\\(['"]${table}['"]\\)\\s*\\.(insert|update|delete|upsert)`, 'i');
    assert(
      !directMutationRegex.test(code),
      `${relPath} performs zero direct table mutations against ${table}`
    );
  });
});

// ------------------------------------------------------------------------------
// SECTION 17: Static Suite Network Safety Self-Audit
// ------------------------------------------------------------------------------
console.log('\n--- 17. Static Suite Network Safety Self-Audit ---');

const selfSource = fs.readFileSync(__filename, 'utf8');

// Strip string literals, regex literals, and comments across the ENTIRE verifier source
const executableSelfCode = selfSource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/'(?:\\.|[^'\\\r\n])*'/g, "''")
  .replace(/"(?:\\.|[^"\\\r\n])*"/g, '""')
  .replace(/`(?:\\.|[^`\\])*`/g, '``')
  .replace(/\/(?![*\/])(?:\\.|[^/\\\r\n])+\/[a-z]*/g, '');

assert(!/\bfetch\s*\(/.test(executableSelfCode), 'Static verification suite contains zero executable fetch()');
assert(!/\baxios\b/.test(executableSelfCode), 'Static verification suite contains zero executable axios calls');
assert(!/\btwilio\s*\(/.test(executableSelfCode), 'Static verification suite contains zero executable twilio() client creation');
assert(!/\bcreateClient\s*\(/.test(executableSelfCode), 'Static verification suite contains zero executable createClient() calls');

const cleanSource = selfSource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');
assert(
  !/import\s+(?:.*?from\s+)?['"]@supabase\/supabase-js['"]/i.test(cleanSource) &&
    !/require\s*\(\s*['"]@supabase\/supabase-js['"]\s*\)/i.test(cleanSource),
  'Static verification suite contains zero @supabase/supabase-js imports'
);


// ------------------------------------------------------------------------------
// SECTION 18: Locked File Quarantine
// ------------------------------------------------------------------------------
console.log('\n--- 18. Locked File Quarantine ---');

const diffOutput = execSync(`git diff --name-only ${baselineCommit}`, { cwd: rootDir, encoding: 'utf8' }).trim();
const diffFiles = diffOutput
  .split(/\r?\n/)
  .map((f) => f.trim().replace(/\\/g, '/'))
  .filter((f) => f.length > 0);

assert(
  diffFiles.length === 0,
  `Zero tracked files modified relative to baseline commit ${baselineCommit}. Modified: [${diffFiles.join(', ')}]`
);

const statusOutput = execSync('git status --porcelain --untracked-files=all', { cwd: rootDir, encoding: 'utf8' }).trim();
const statusLines = statusOutput
  .split(/\r?\n/)
  .map((l) => l.trim().replace(/\\/g, '/'))
  .filter((l) => l.length > 0);

const unexpectedChanges = statusLines.filter((line) => {
  const filePath = line.replace(/^[?\sMADRCU]+\s+/, '').trim();
  // Allowed untracked file is tests/phase9-telephony-verification.mjs
  if (filePath === 'tests/phase9-telephony-verification.mjs') {
    return false;
  }
  // Ignore local generated/tooling folders
  if (filePath.startsWith('.gemini/') || filePath.startsWith('.next/') || filePath.startsWith('node_modules/')) {
    return false;
  }
  return true;
});

assert(
  unexpectedChanges.length === 0,
  `Quarantine verified: only tests/phase9-telephony-verification.mjs is present. Unexpected: [${unexpectedChanges.join(', ')}]`
);

console.log('\n================================================================');
console.log(`  PASSED ALL CHECKS: ${passedChecks} / ${totalChecks} ASSERTIONS SUCCESSFUL`);
console.log('================================================================\n');
