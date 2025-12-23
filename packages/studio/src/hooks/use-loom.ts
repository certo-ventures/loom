import { useState, useEffect, useCallback } from 'react';
import { loomClient } from '../lib/loom-client';
import { ActorInfo, MetricsData, HealthStatus, JournalEntry, TraceEvent } from '../types/loom';

export function useLoomConnection() {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const handleConnection = (data: any) => {
      setIsConnected(data.status === 'connected');
      setConnectionStatus(data.status);
      if (data.error) {
        setError(data.error);
      } else {
        setError(null);
      }
    };

    loomClient.on('connection', handleConnection);

    // Attempt initial connection
    setConnectionStatus('connecting');
    loomClient.connect().catch(err => {
      setError(err);
      setConnectionStatus('error');
    });

    return () => {
      loomClient.off('connection', handleConnection);
    };
  }, []);

  const reconnect = useCallback(() => {
    setConnectionStatus('connecting');
    setError(null);
    loomClient.connect().catch(err => {
      setError(err);
      setConnectionStatus('error');
    });
  }, []);

  return { isConnected, connectionStatus, error, reconnect };
}

export function useActors() {
  const [actors, setActors] = useState<ActorInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const handleActors = (data: ActorInfo[]) => {
      setActors(data);
      setLoading(false);
    };

    loomClient.subscribeToActors(handleActors);
    loomClient.on('actors', handleActors);

    return () => {
      loomClient.off('actors', handleActors);
    };
  }, []);

  return { actors, loading };
}

export function useMetrics() {
  const [metrics, setMetrics] = useState<MetricsData | null>(null);

  useEffect(() => {
    const handleMetrics = (data: MetricsData) => {
      setMetrics(data);
    };

    loomClient.subscribeToMetrics(handleMetrics);
    loomClient.on('metrics', handleMetrics);

    return () => {
      loomClient.off('metrics', handleMetrics);
    };
  }, []);

  return metrics;
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

export function useJournal(actorId: string | null) {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!actorId) {
      setEntries([]);
      setLoading(false);
      return;
    }

    const handleJournal = (data: JournalEntry[]) => {
      setEntries(data);
      setLoading(false);
    };

    loomClient.subscribeToJournal(actorId, handleJournal);
    loomClient.on(`journal:${actorId}`, handleJournal);

    return () => {
      loomClient.off(`journal:${actorId}`, handleJournal);
    };
  }, [actorId]);

  return { entries, loading };
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
