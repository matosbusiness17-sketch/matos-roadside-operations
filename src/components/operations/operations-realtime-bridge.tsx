'use client';

import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';

export interface OperationsRealtimeBridgeProps {
  onInvalidate: () => void | Promise<void>;
}

export function OperationsRealtimeBridge({ onInvalidate }: OperationsRealtimeBridgeProps) {
  const onInvalidateRef = useRef(onInvalidate);

  useEffect(() => {
    onInvalidateRef.current = onInvalidate;
  }, [onInvalidate]);

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const supabase = createClient();

    // Trigger debounced invalidation signal (collapses rapid burst events into one authoritative refresh)
    const handleInvalidationEvent = () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        void onInvalidateRef.current();
      }, 250);
    };

    // Single named channel for operational workspace invalidation
    const channel = supabase
      .channel('operations_workspace_sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'vehicles' },
        handleInvalidationEvent
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'incidents' },
        handleInvalidationEvent
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'assignments' },
        handleInvalidationEvent
      )
      .subscribe((status, err) => {
        if (err) {
          // Log non-destructively; do not throw or disrupt existing workspace snapshot
          console.warn('Realtime operations sync subscription status:', status, err.message);
        }
      });

    // Cleanup: clear pending debounce timer and unsubscribe channel
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      void supabase.removeChannel(channel);
    };
  }, []);

  // Invisible synchronization bridge component
  return null;
}
