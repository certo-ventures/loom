import { useEffect, useCallback, useState } from 'react';
import { loomClient } from '../lib/loom-client';
import { useStudio } from '../stores/studio';
import { ActorInfo, MetricsData, HealthStatus, JournalEntry, TraceEvent } from '../types/loom';

/**
 * Hook to manage WebSocket connection and sync with store
 * Call this once at the app level to establish connection
 */
export function useLoomConnection() {
  const isConnected = useStudio((state) => state.isConnected);
  const connectionStatus = useStudio((state) => state.connectionStatus);
  const error = useStudio((state) => state.connectionError);
  const setConnection = useStudio((state) => state.setConnection);

  useEffect(() => {
    const handleConnection = (data: any) => {
      setConnection(data.status, data.error);
    };

    loomClient.on('connection', handleConnection);

    // Attempt initial connection
    setConnection('connecting');
    loomClient.connect().catch(err => {
      setConnection('error', err);
    });

    return () => {
      loomClient.off('connection', handleConnection);
    };
  }, [setConnection]);

  const reconnect = useCallback(() => {
    setConnection('connecting');
    loomClient.connect().catch(err => {
      setConnection('error', err);
    });
  }, [setConnection]);

  return { isConnected, connectionStatus, error, reconnect };
}

/**
 * Hook to sync actors from WebSocket to store
 * Call this once at the app level
 */
export function useActors() {
  const setActors = useStudio((state) => state.setActors);
  const updateActor = useStudio((state) => state.updateActor);

  useEffect(() => {
    const handleActors = (data: ActorInfo[]) => {
      setActors(data);
    };

    const handleActorUpdate = (data: ActorInfo) => {
      updateActor(data);
    };

    loomClient.subscribeToActors(handleActors);
    loomClient.on('actors', handleActors);
    loomClient.on('actor:updated', handleActorUpdate);

    return () => {
      loomClient.off('actors', handleActors);
      loomClient.off('actor:updated', handleActorUpdate);
    };
  }, [setActors, updateActor]);

  // Components should use useStudio directly, not this hook's return value
  return null;
}

/**
 * Hook to sync metrics from WebSocket to store
 * Call this once at the app level
 */
export function useMetrics() {
  const setMetrics = useStudio((state) => state.setMetrics);

  useEffect(() => {
    const handleMetrics = (data: MetricsData) => {
      setMetrics(data);
    };

    loomClient.subscribeToMetrics(handleMetrics);
    loomClient.on('metrics', handleMetrics);

    return () => {
      loomClient.off('metrics', handleMetrics);
    };
  }, [setMetrics]);

  // Components should use useStudio directly, not this hook's return value
  return null;
}

export function useHealth() {
  const [health, setHealth] = useState<HealthStatus | null>(null);

  useEffect(() => {
    const handleHealth = (data: HealthStatus) => {
      setHealth(data);
    };

    loomClient.subscribeToHealth(handleHealth);
    loomClient.on('health', handleHealth);

    return () => {
      loomClient.off('health', handleHealth);
    };
  }, []);

  return health;
}

/**
 * Hook to sync journal entries from WebSocket to store
 * Call this for each actor being monitored
 */
export function useJournal(actorId: string | null) {
  const setJournalEntries = useStudio((state) => state.setJournalEntries);
  const addJournalEntry = useStudio((state) => state.addJournalEntry);

  useEffect(() => {
    if (!actorId) {
      return;
    }

    const handleJournal = (data: JournalEntry[]) => {
      setJournalEntries(actorId, data);
    };

    const handleJournalEntry = (data: JournalEntry) => {
      addJournalEntry(actorId, data);
    };

    loomClient.subscribeToJournal(actorId, handleJournal);
    loomClient.on(`journal:${actorId}`, handleJournal);
    loomClient.on(`journal:${actorId}:entry`, handleJournalEntry);

    return () => {
      loomClient.off(`journal:${actorId}`, handleJournal);
      loomClient.off(`journal:${actorId}:entry`, handleJournalEntry);
    };
  }, [actorId, setJournalEntries, addJournalEntry]);

  // Components should use useActorJournal selector, not this hook's return value
  return null;
}

export function useTraces(correlationId: string | null) {
  const [traces, setTraces] = useState<TraceEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!correlationId) {
      setTraces([]);
      setLoading(false);
      return;
    }

    const handleTraces = (data: TraceEvent[]) => {
      setTraces(data);
      setLoading(false);
    };

    loomClient.subscribeToTraces(correlationId, handleTraces);
    loomClient.on(`traces:${correlationId}`, handleTraces);

    return () => {
      loomClient.off(`traces:${correlationId}`, handleTraces);
    };
  }, [correlationId]);

  return { traces, loading };
}
