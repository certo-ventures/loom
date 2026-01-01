import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryExtractor, type ExtractionResult } from '../../../src/memory/graph/extractor';

describe('MemoryExtractor', () => {
  let extractor: MemoryExtractor;
  let mockFetch: any;

  beforeEach(() => {
    // Mock global fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    extractor = new MemoryExtractor({
      endpoint: 'https://api.openai.com',
      apiKey: 'test-key',
      model: 'gpt-4'
    });
  });

  it('should extract entities and facts from text', async () => {
    // Mock LLM response
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              entities: [
                { name: 'Alice', type: 'person' },
                { name: 'TechStart', type: 'company' }
              ],
              facts: [
                {
                  sourceEntity: 'Alice',
                  relation: 'works_at',
                  targetEntity: 'TechStart',
                  text: 'Alice works at TechStart',
                  confidence: 0.95
                }
              ]
            })
          }
        }]
      })
    });

    const result = await extractor.extract('Alice works at TechStart');

    expect(result.entities).toHaveLength(2);
    expect(result.entities[0].name).toBe('Alice');
    expect(result.entities[0].type).toBe('person');
    expect(result.entities[1].name).toBe('TechStart');
    expect(result.entities[1].type).toBe('company');

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].sourceEntity).toBe('Alice');
    expect(result.facts[0].relation).toBe('works_at');
    expect(result.facts[0].targetEntity).toBe('TechStart');
    expect(result.facts[0].confidence).toBe(0.95);
  });

  it('should handle multiple facts', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              entities: [
                { name: 'Alice', type: 'person' },
                { name: 'Bob', type: 'person' },
                { name: 'pizza', type: 'food' }
              ],
              facts: [
                {
                  sourceEntity: 'Alice',
                  relation: 'likes',
                  targetEntity: 'pizza',
                  text: 'Alice likes pizza',
                  confidence: 0.9
                },
                {
                  sourceEntity: 'Bob',
                  relation: 'likes',
                  targetEntity: 'pizza',
                  text: 'Bob likes pizza',
                  confidence: 0.9
                },
                {
                  sourceEntity: 'Alice',
                  relation: 'knows',
                  targetEntity: 'Bob',
                  text: 'Alice knows Bob',
                  confidence: 0.85
                }
              ]
            })
          }
        }]
      })
    });

    const result = await extractor.extract('Alice and Bob both like pizza. They know each other.');

    expect(result.entities).toHaveLength(3);
    expect(result.facts).toHaveLength(3);
  });

  it('should handle entity summaries', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              entities: [
                { 
                  name: 'Alice', 
                  type: 'person',
                  summary: 'Software engineer who enjoys Italian food'
                }
              ],
              facts: []
            })
          }
        }]
      })
    });

    const result = await extractor.extract('Alice is a software engineer who enjoys Italian food');

    expect(result.entities[0].summary).toBe('Software engineer who enjoys Italian food');
  });

  it('should parse JSON wrapped in code blocks', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: '```json\n{"entities": [], "facts": []}\n```'
          }
        }]
      })
    });

    const result = await extractor.extract('Some text');

    expect(result).toEqual({ entities: [], facts: [] });
  });

  it('should handle empty extraction results', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              entities: [],
              facts: []
            })
          }
        }]
      })
    });

    const result = await extractor.extract('The weather is nice today');

    expect(result.entities).toHaveLength(0);
    expect(result.facts).toHaveLength(0);
  });

  it('should handle malformed JSON gracefully', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: 'Not valid JSON at all'
          }
        }]
      })
    });

    const result = await extractor.extract('Some text');

    // Should return empty result rather than throwing
    expect(result).toEqual({ entities: [], facts: [] });
  });

  it('should throw on API errors', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized'
    });

    await expect(extractor.extract('Some text')).rejects.toThrow('LLM API error: 401');
  });

  it('should build proper prompt with instructions', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"entities": [], "facts": []}' } }]
      })
    });

    await extractor.extract('Test text');

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    const prompt = body.messages[0].content;

    expect(prompt).toContain('Extract entities and relationships');
    expect(prompt).toContain('Test text');
    expect(prompt).toContain('Return JSON only');
    expect(prompt).toContain('"entities":');
    expect(prompt).toContain('"facts":');
  });

  it('should use low temperature for consistent extraction', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"entities": [], "facts": []}' } }]
      })
    });

    await extractor.extract('Test');

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);

    expect(body.temperature).toBe(0.1);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('should support Azure OpenAI endpoint', async () => {
    const azureExtractor = new MemoryExtractor({
      endpoint: 'https://myservice.openai.azure.com',
      apiKey: 'azure-key',
      deploymentName: 'gpt-4'
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"entities": [], "facts": []}' } }]
      })
    });

    await azureExtractor.extract('Test');

    const callArgs = mockFetch.mock.calls[0];
    const url = callArgs[0];
    const headers = callArgs[1].headers;

    expect(url).toContain('azure.com');
    expect(url).toContain('deployments/gpt-4');
    expect(headers['api-key']).toBe('azure-key');
  });
});
