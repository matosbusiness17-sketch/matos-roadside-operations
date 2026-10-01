/**
 * Matos Systems — Vapi Automated Telephony Webhook Route
 * Phase 9B Voice Incident Intake Handler
 *
 * Receives authenticated tool-call events from Vapi, validates structured incident
 * data, generates deterministic boundary idempotency keys, and triggers the
 * authoritative database RPC public.create_voice_intake_incident via voice-actions.
 */

import {
  validateVapiBearerToken,
  validateVapiWebhookEnvelope,
  validateCreateIncidentArgs,
  buildVapiIdempotencyKey,
  formatVoiceIntakeToolResult,
} from '@/lib/telephony/vapi-validator';
import { executeVoiceIntakeIncident } from '@/lib/telephony/voice-actions';
import type { VapiToolResultItem, VapiWebhookResponse } from '@/types/telephony';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  try {
    // 1. HTTP Bearer Authentication MUST occur before parsing or database operations
    const authHeader = request.headers.get('authorization');
    const expectedSecret = process.env.VAPI_WEBHOOK_SECRET;

    if (!validateVapiBearerToken(authHeader, expectedSecret)) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Once authenticated, expectedSecret is guaranteed non-empty and valid
    const integrationSecret = expectedSecret!.trim();

    // 2. Read and parse incoming JSON payload
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    // 3. Validate Vapi webhook envelope (message.type === 'tool-calls', call.id, toolCallList/toolCalls)
    const envelopeResult = validateVapiWebhookEnvelope(rawBody);
    if (!envelopeResult.isValid) {
      return new Response('Bad Request', { status: 400 });
    }

    const { callId, toolCalls } = envelopeResult.data;

    // 4. Fail closed if the validated envelope contains zero tool calls
    if (toolCalls.length === 0) {
      return new Response('Bad Request', { status: 400 });
    }

    // 5. Inspect toolCalls for duplicate IDs BEFORE any execution or database mutation
    const seenIds = new Set<string>();
    for (const toolCall of toolCalls) {
      if (seenIds.has(toolCall.id)) {
        return new Response('Bad Request', { status: 400 });
      }
      seenIds.add(toolCall.id);
    }

    // 6. Process each unique tool call inside its own isolated execution boundary
    const results: VapiToolResultItem[] = [];

    for (const toolCall of toolCalls) {
      const { id: toolCallId, name: toolName, arguments: toolArgs } = toolCall;

      try {
        // Phase 9B supports ONLY 'create_incident'. Any other tool returns an unsupported tool error.
        if (toolName !== 'create_incident') {
          results.push({
            toolCallId,
            error: 'Unsupported tool.',
          });
          continue;
        }

        // Validate create_incident arguments
        const validation = validateCreateIncidentArgs(toolArgs);
        if (!validation.isValid) {
          results.push({
            toolCallId,
            error: `Failed to create incident: ${validation.error}`,
          });
          continue;
        }

        // Derive deterministic idempotency key: vapi:<callId>:<toolCallId>
        const idempotencyKey = buildVapiIdempotencyKey(callId, toolCallId);

        // Execute authoritative intake RPC
        const intakeResult = await executeVoiceIntakeIncident({
          integrationSecret,
          idempotencyKey,
          params: validation.params,
        });

        // Format truthful tool result
        results.push(formatVoiceIntakeToolResult(toolCallId, intakeResult));
      } catch {
        // Unexpected per-item exception: isolate and return a safe correlated error for this tool only
        results.push({
          toolCallId,
          error: 'Failed to process tool call.',
        });
      }
    }

    // 7. Return HTTP 200 with correlated results array
    const responseBody: VapiWebhookResponse = { results };
    return Response.json(responseBody, { status: 200 });
  } catch {
    // Unexpected route-level infrastructure failure that prevents constructing a response
    return new Response('Internal Server Error', { status: 500 });
  }
}
