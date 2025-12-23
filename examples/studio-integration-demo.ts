/**
 * Studio Integration - Event-Driven Edition
 * NO POLLING - pure events via Redis Pub/Sub!
 */

import { DiscoveryService, InMemoryActorEventBus } from '../src/discovery';

async function demo() {
  const eventBus = new InMemoryActorEventBus();
  const discovery = new DiscoveryService(undefined, eventBus);

  await discovery.subscribe(async (event) => {
    console.log('Event:', event.type, event.actorId);
    
    try {
      await fetch('http://localhost:9090/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });
    } catch (e) {}
  });

  await discovery.registerActor('counter-1', 'CounterActor', 'worker-1');
  await discovery.registerActor('counter-2', 'CounterActor', 'worker-1');
  await discovery.registerActor('aggregator-1', 'AggregatorActor', 'worker-2');

  setInterval(async () => {
    await eventBus.publish({
      type: 'actor:message-processed',
      actorId: 'counter-1',
      actorType: 'CounterActor',
      workerId: 'worker-1',
      timestamp: new Date().toISOString(),
    });
  }, 1000);

  console.log('Demo running - event-driven, NO POLLING!');
}

if (require.main === module) {
  demo();
}
