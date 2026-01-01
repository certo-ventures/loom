/**
 * End-to-End Demo: Customer Service Chatbot with Memory
 * 
 * This example demonstrates:
 * 1. Actor with memory graph integration
 * 2. Lamport clocks for distributed ordering
 * 3. Auto-extraction of entities and facts
 * 4. Semantic search for context retrieval
 * 5. Temporal queries (facts valid at specific times)
 */

import { Actor } from '../src/actor/actor';
import { ActorMemory } from '../src/memory/graph/actor-memory';
import { InMemoryGraphStorage } from '../src/memory/graph/in-memory-storage';
import { MemoryExtractor } from '../src/memory/graph/extractor';
import { LamportClock } from '../src/timing/lamport-clock';

interface CustomerServiceMessage {
  userId: string;
  message: string;
  timestamp: Date;
}

interface CustomerServiceResponse {
  response: string;
  context_used: string[];
  facts_extracted: number;
}

/**
 * Customer Service Actor with integrated memory
 */
class CustomerServiceBot extends Actor {
  private memory: ActorMemory;
  private lamportClock: LamportClock;

  constructor(
    actorId: string,
    private systemPrompt: string,
    private extractorConfig?: { endpoint: string; apiKey: string; model?: string }
  ) {
    super(actorId);
    
    // Initialize Lamport clock for distributed ordering
    this.lamportClock = new LamportClock();
    
    // Initialize memory with optional auto-extraction
    const storage = new InMemoryGraphStorage();
    const extractor = extractorConfig 
      ? new MemoryExtractor(extractorConfig.endpoint, extractorConfig.apiKey, extractorConfig.model)
      : undefined;
    
    this.memory = new ActorMemory(
      actorId,
      storage,
      this.lamportClock,
      'customer-service-graph',
      extractor
    );
  }

  /**
   * Handle incoming customer message
   */
  async execute(input: CustomerServiceMessage): Promise<CustomerServiceResponse> {
    const { userId, message, timestamp } = input;
    
    // Tick logical clock for this interaction
    this.lamportClock.tick();
    const logicalTime = this.lamportClock.get();
    
    console.log(`[${logicalTime}] Processing message from ${userId}: "${message}"`);
    
    // 1. Search memory for relevant context about this user
    const relevantContext = await this.searchRelevantContext(userId, message);
    
    // 2. Store this conversation turn as an episode (with auto-extraction if configured)
    const episodeContent = JSON.stringify({
      type: 'customer_message',
      user_id: userId,
      message,
      timestamp: timestamp.toISOString(),
    });
    
    const episodeId = await this.memory.addEpisode(episodeContent, 'json');
    
    console.log(`[${logicalTime}] Stored episode ${episodeId}`);
    
    // 3. Generate response using context
    const response = this.generateResponse(userId, message, relevantContext);
    
    // 4. Store the bot's response as another episode
    const responseContent = JSON.stringify({
      type: 'bot_response',
      user_id: userId,
      response,
      timestamp: new Date().toISOString(),
    });
    
    await this.memory.addEpisode(responseContent, 'json');
    
    return {
      response,
      context_used: relevantContext,
      facts_extracted: 0, // Will be non-zero if auto-extraction is enabled
    };
  }

  /**
   * Search for relevant context using semantic + text search
   */
  private async searchRelevantContext(userId: string, message: string): Promise<string[]> {
    const context: string[] = [];
    
    // Get all entities for this user
    const entities = await this.memory.getEntities();
    const userEntity = entities.find(e => e.name === userId);
    
    if (!userEntity) {
      return context;
    }
    
    // Search for facts about this specific user
    const userFacts = await this.memory.search({
      source_entity_ids: [userEntity.id],
      asOf: new Date(), // Only facts valid now
    });
    
    if (userFacts.length > 0) {
      context.push(`Known facts about ${userId}:`);
      userFacts.slice(0, 3).forEach((fact) => {
        // Look up the target entity to get its name
        const targetEntity = entities.find(e => e.id === fact.targetEntityId);
        context.push(`  - ${fact.relation}: ${targetEntity?.name || fact.targetEntityId}`);
      });
    }
    
    // Search for similar past interactions (semantic search if embeddings available)
    try {
      const similarEpisodes = await this.memory.searchHybrid(
        message, // text query
        undefined, // no embedding for now (would need embedding service)
        { limit: 2 }
      );
      
      if (similarEpisodes.length > 0) {
        context.push(`Similar past interactions:`);
        similarEpisodes.forEach((episode) => {
          context.push(`  - ${episode.content}`);
        });
      }
    } catch (error) {
      // Hybrid search may fail if no embeddings - fall back to text only
      console.log(`Hybrid search not available, using facts only`);
    }
    
    return context;
  }

  /**
   * Generate response (simplified - in real app would call LLM)
   */
  private generateResponse(userId: string, message: string, context: string[]): string {
    const hasContext = context.length > 0;
    
    // Simple rule-based responses for demo
    if (message.toLowerCase().includes('order') && message.toLowerCase().includes('status')) {
      return hasContext
        ? `Let me check on that order for you. Based on our records: ${context.join(', ')}`
        : `I'll look up your order status. Can you provide your order number?`;
    }
    
    if (message.toLowerCase().includes('hello') || message.toLowerCase().includes('hi')) {
      return hasContext
        ? `Welcome back! I remember: ${context[0] || 'our previous conversations'}.`
        : `Hello! How can I assist you today?`;
    }
    
    return hasContext
      ? `I understand. Here's what I know: ${context.slice(0, 2).join(' ')}`
      : `I'm here to help. Could you provide more details?`;
  }

  /**
   * Get memory statistics
   */
  async getMemoryStats() {
    const allFacts = await this.memory.search({});
    const allEpisodes = await this.memory.getRecentEpisodes(100);
    
    return {
      total_facts: allFacts.length,
      total_episodes: allEpisodes.length,
      logical_time: this.lamportClock.get(),
    };
  }
}

/**
 * Demo: Customer service conversation with memory
 */
async function runCustomerServiceDemo() {
  console.log('=== Customer Service Bot Demo with Memory ===\n');
  
  // Create bot with memory (no auto-extraction for this demo)
  const bot = new CustomerServiceBot(
    'customer-service-bot-001',
    'You are a helpful customer service assistant.'
  );
  
  const userId = 'customer-12345';
  
  // Conversation 1: Initial contact
  console.log('--- Conversation 1 ---');
  let result = await bot.execute({
    userId,
    message: 'Hello, I need help with my order',
    timestamp: new Date('2024-12-30T10:00:00Z'),
  });
  console.log(`Bot: ${result.response}\n`);
  
  // Create entity for the customer and add facts
  const customerEntityId = await bot['memory'].addEntity(userId, 'customer', 'Regular customer');
  const orderEntityId = await bot['memory'].addEntity('ORD-789', 'order', 'Customer order');
  
  await bot['memory'].addFact(
    customerEntityId,
    'has_order',
    orderEntityId,
    `Customer ${userId} has order ORD-789`,
    { validFrom: new Date('2024-12-28T00:00:00Z'), confidence: 1.0 }
  );
  
  const statusEntityId = await bot['memory'].addEntity('shipped', 'order_status', 'Order shipped status');
  await bot['memory'].addFact(
    orderEntityId,
    'current_status',
    statusEntityId,
    'Order ORD-789 status is shipped',
    { validFrom: new Date('2024-12-29T00:00:00Z'), confidence: 1.0 }
  );
  
  // Conversation 2: Follow-up (bot should remember the order)
  console.log('--- Conversation 2 ---');
  result = await bot.execute({
    userId,
    message: 'What is the status of my order?',
    timestamp: new Date('2024-12-30T10:05:00Z'),
  });
  console.log(`Bot: ${result.response}`);
  console.log(`Context used: ${result.context_used.length} items\n`);
  
  // Conversation 3: Different user, no context
  console.log('--- Conversation 3 (New User) ---');
  result = await bot.execute({
    userId: 'customer-99999',
    message: 'Hi, I need help',
    timestamp: new Date('2024-12-30T10:10:00Z'),
  });
  console.log(`Bot: ${result.response}`);
  console.log(`Context used: ${result.context_used.length} items\n`);
  
  // Show memory statistics
  const stats = await bot.getMemoryStats();
  console.log('--- Memory Statistics ---');
  console.log(`Total Facts: ${stats.total_facts}`);
  console.log(`Total Episodes: ${stats.total_episodes}`);
  console.log(`Logical Time: ${stats.logical_time}`);
  console.log('\nDemo complete! ✅');
}

/**
 * Demo with Auto-Extraction (requires LLM API)
 */
async function runAutoExtractionDemo() {
  console.log('\n=== Auto-Extraction Demo (with LLM) ===\n');
  
  // This would require actual API credentials
  const bot = new CustomerServiceBot(
    'customer-service-bot-002',
    'You are a helpful customer service assistant.',
    {
      endpoint: process.env.OPENAI_ENDPOINT || 'https://api.openai.com',
      apiKey: process.env.OPENAI_API_KEY || 'your-api-key-here',
      model: 'gpt-4',
    }
  );
  
  console.log('NOTE: Auto-extraction requires valid OpenAI/Azure API credentials.');
  console.log('Set OPENAI_ENDPOINT and OPENAI_API_KEY environment variables.\n');
  
  // With auto-extraction, facts would be automatically extracted from:
  // - User message: "My name is Alice and I live in Seattle"
  // - Extracted: { subject: "Alice", predicate: "lives_in", object: "Seattle" }
}

// Run the demo
runCustomerServiceDemo()
  .catch((error) => {
    console.error('Demo failed:', error);
    process.exit(1);
  });

export { CustomerServiceBot };
