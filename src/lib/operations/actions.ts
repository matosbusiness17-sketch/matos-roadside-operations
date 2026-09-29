'use server';

import { getOperationsSnapshot } from '@/lib/operations/data';
import { OperationsSnapshotResult } from '@/types';

/**
 * Server action to manually refresh the operations map snapshot.
 * Acts as a thin server action wrapper around getOperationsSnapshot().
 * Does not accept client-supplied tenant, role, or credentials.
 */
export async function refreshOperationsSnapshot(): Promise<OperationsSnapshotResult> {
  return getOperationsSnapshot();
}
