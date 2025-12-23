import { ActorInfo, JournalEntry, MetricsData, HealthStatus, TraceEvent } from '../types/loom';

type MessageHandler = (data: any) => void;

export class LoomClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private handlers = new Map<string, Set<MessageHandler>>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private isConnecting = false;

  constructor(private url: string = 'ws://localhost:9090/ws') {}

  connect(): Promise<void> {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      return Promise.resolve();
    }

    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log('[LoomClient] Connected to Loom runtime');
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.emit('connection', { status: 'connected' });
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            console.error('[LoomClient] Failed to parse message:', error);
          }
        };

        this.ws.onerror = (error) => {
          console.error('[LoomClient] WebSocket error:', error);
          this.isConnecting = false;
          this.emit('connection', { status: 'error', error });
        };

        this.ws.onclose = () => {
          console.log('[LoomClient] Disconnected from Loom runtime');
          this.isConnecting = false;
          this.ws = null;
          this.emit('connection', { status: 'disconnected' });
          this.scheduleReconnect();
        };

        // Timeout if connection takes too long
        setTimeout(() => {
          if (this.isConnecting) {
            this.isConnecting = false;
            reject(new Error('Connection timeout'));
          }
        }, 5000);
      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[LoomClient] Max reconnect attempts reached');
      return;
    }

    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    console.log(`[LoomClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(console.error);
    }, delay);
  }

  private handleMessage(message: any) {
    const { type, data } = message;
    this.emit(type, data);
  }

  on(event: string, handler: MessageHandler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler: MessageHandler) {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  private emit(event: string, data: any) {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }
  }

  send(type: string, data?: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data }));
    } else {
      console.warn('[LoomClient] Cannot send message - not connected');
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  // Convenience methods for subscribing to specific data
  subscribeToActors(handler: (actors: ActorInfo[]) => void) {
    this.on('actors', handler);
    if (this.isConnected()) {
      this.send('subscribe', { channel: 'actors' });
    }
  }

  subscribeToMetrics(handler: (metrics: MetricsData) => void) {
    this.on('metrics', handler);
    if (this.isConnected()) {
      this.send('subscribe', { channel: 'metrics' });
    }
  }

  subscribeToHealth(handler: (health: HealthStatus) => void) {
    this.on('health', handler);
    if (this.isConnected()) {
      this.send('subscribe', { channel: 'health' });
    }
  }

  subscribeToJournal(actorId: string, handler: (entries: JournalEntry[]) => void) {
    this.on(`journal:${actorId}`, handler);
    if (this.isConnected()) {
      this.send('subscribe', { channel: 'journal', actorId });
    }
  }

  subscribeToTraces(correlationId: string, handler: (traces: TraceEvent[]) => void) {
    this.on(`traces:${correlationId}`, handler);
    if (this.isConnected()) {
      this.send('subscribe', { channel: 'traces', correlationId });
    }
  }
}

// Singleton instance
export const loomClient = new LoomClient();
