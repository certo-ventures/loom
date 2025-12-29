/**
 * Studio Store - Single source of truth for all Studio state
 * 
 * Uses Zustand for optimal performance with granular subscriptions.
 * Each component only re-renders when its specific data changes.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { ActorInfo, MetricsData, JournalEntry } from '../types/loom';

interface StudioState {
  // Connection state
  isConnected: boolean;
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
  connectionError: Error | null;

  // Actor data
  actors: Map<string, ActorInfo>;
  selectedActorId: string | null;

  // Journal data (keyed by actorId)
  journalEntries: Map<string, JournalEntry[]>;

  // Metrics
  metrics: MetricsData | null;

  // UI state
  activeTab: 'overview' | 'actors' | 'network' | 'timeline' | 'metrics';

  // Actions - Connection
  setConnection: (status: StudioState['connectionStatus'], error?: Error) => void;
  
  // Actions - Actors
  setActors: (actors: ActorInfo[]) => void;
  updateActor: (actor: ActorInfo) => void;
  selectActor: (id: string | null) => void;

  // Actions - Journal
  setJournalEntries: (actorId: string, entries: JournalEntry[]) => void;
  addJournalEntry: (actorId: string, entry: JournalEntry) => void;

  // Actions - Metrics
  setMetrics: (metrics: MetricsData) => void;

  // Actions - UI
  setActiveTab: (tab: StudioState['activeTab']) => void;
}

export const useStudio = create<StudioState>()(
  devtools(
    (set) => ({
      // Initial state
      isConnected: false,
      connectionStatus: 'disconnected',
      connectionError: null,
      actors: new Map(),
      selectedActorId: null,
      journalEntries: new Map(),
      metrics: null,
      activeTab: 'overview',

      // Connection actions
      setConnection: (status, error) =>
        set({
          connectionStatus: status,
          isConnected: status === 'connected',
          connectionError: error || null,
        }),

      // Actor actions
      setActors: (actors) =>
        set({
          actors: new Map(actors.map((a) => [a.id, a])),
        }),

      updateActor: (actor) =>
        set((state) => {
          const actors = new Map(state.actors);
          actors.set(actor.id, actor);
          return { actors };
        }),

      selectActor: (id) =>
        set({ selectedActorId: id }),

      // Journal actions
      setJournalEntries: (actorId, entries) =>
        set((state) => {
          const journalEntries = new Map(state.journalEntries);
          journalEntries.set(actorId, entries);
          return { journalEntries };
        }),

      addJournalEntry: (actorId, entry) =>
        set((state) => {
          const journalEntries = new Map(state.journalEntries);
          const current = journalEntries.get(actorId) || [];
          journalEntries.set(actorId, [...current, entry]);
          return { journalEntries };
        }),

      // Metrics actions
      setMetrics: (metrics) =>
        set({ metrics }),

      // UI actions
      setActiveTab: (tab) =>
        set({ activeTab: tab }),
    }),
    { name: 'LoomStudio' }
  )
);

// Selectors - Derived state with automatic memoization
export const useSelectedActor = () =>
  useStudio((state) =>
    state.selectedActorId ? state.actors.get(state.selectedActorId) : null
  );

export const useActorJournal = (actorId: string | null) =>
  useStudio((state) =>
    actorId ? state.journalEntries.get(actorId) || [] : []
  );

export const useActorsList = () =>
  useStudio((state) => Array.from(state.actors.values()));
