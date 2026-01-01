/**
 * Memory Extractor
 * Uses LLM to extract entities and relationships from text
 */

export interface ExtractedEntity {
  name: string;
  type: string;
  summary?: string;
}

export interface ExtractedFact {
  sourceEntity: string;  // Entity name
  relation: string;
  targetEntity: string;  // Entity name
  text: string;
  confidence?: number;
}

export interface ExtractionResult {
  entities: ExtractedEntity[];
  facts: ExtractedFact[];
}

export interface LLMConfig {
  endpoint: string;
  apiKey?: string;
  deploymentName?: string;
  model?: string;
}

/**
 * MemoryExtractor uses an LLM to extract structured knowledge from text
 */
export class MemoryExtractor {
  constructor(private config: LLMConfig) {}

  /**
   * Extract entities and facts from text using LLM
   */
  async extract(text: string): Promise<ExtractionResult> {
    const prompt = this.buildExtractionPrompt(text);
    const response = await this.callLLM(prompt);
    return this.parseExtractionResponse(response);
  }

  private buildExtractionPrompt(text: string): string {
    return `Extract entities and relationships from the following text. Return JSON only, no other text.

Text: "${text}"

Return format:
{
  "entities": [
    {"name": "Alice", "type": "person", "summary": "optional description"}
  ],
  "facts": [
    {"sourceEntity": "Alice", "relation": "likes", "targetEntity": "pizza", "text": "Alice likes pizza", "confidence": 0.9}
  ]
}

Rules:
- Extract people, places, things, companies, etc.
- Relations should be simple verbs: "likes", "works_at", "knows", "located_in", etc.
- Each fact should be a single relationship
- Confidence is optional (0.0 to 1.0)
- Keep entity names consistent
- Only extract clear, factual information

JSON:`;
  }

  private async callLLM(prompt: string): Promise<string> {
    // Support both Azure OpenAI and OpenAI
    const isAzure = this.config.endpoint.includes('azure.com');
    
    let url: string;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (isAzure) {
      // Azure OpenAI format
      url = `${this.config.endpoint}/openai/deployments/${this.config.deploymentName}/chat/completions?api-version=2024-02-15-preview`;
      if (this.config.apiKey) {
        headers['api-key'] = this.config.apiKey;
      }
    } else {
      // OpenAI format
      url = 'https://api.openai.com/v1/chat/completions';
      if (this.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      }
    }

    const body = {
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      model: this.config.model || 'gpt-4',
      temperature: 0.1, // Low temperature for consistent extraction
      response_format: { type: 'json_object' }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LLM API error: ${response.status} - ${error}`);
    }

    const data: any = await response.json();
    return data.choices[0].message.content;
  }

  private parseExtractionResponse(response: string): ExtractionResult {
    try {
      // Handle cases where LLM might wrap JSON in code blocks
      let cleaned = response.trim();
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.slice(7);
      }
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.slice(3);
      }
      if (cleaned.endsWith('```')) {
        cleaned = cleaned.slice(0, -3);
      }
      cleaned = cleaned.trim();

      const parsed = JSON.parse(cleaned);
      
      return {
        entities: parsed.entities || [],
        facts: parsed.facts || []
      };
    } catch (error) {
      console.warn('Failed to parse extraction response:', response);
      return { entities: [], facts: [] };
    }
  }
}
