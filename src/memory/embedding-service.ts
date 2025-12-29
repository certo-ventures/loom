/**
 * Embedding Service
 * Generates vector embeddings using OpenAI/Azure OpenAI
 */

import type { EmbeddingConfig } from '../config/types.js'
import { DefaultAzureCredential } from '@azure/identity'

export class EmbeddingService {
  constructor(private config: EmbeddingConfig) {}

  async embed(text: string): Promise<number[]> {
    if (this.config.provider === 'azure-openai') {
      return this.embedAzure(text)
    } else {
      return this.embedOpenAI(text)
    }
  }

  private async embedAzure(text: string): Promise<number[]> {
    if (this.config.provider !== 'azure-openai') {
      throw new Error('Invalid provider')
    }
    
    const { azure } = this.config
    const apiVersion = azure.apiVersion || '2023-05-15'
    const url = `${azure.endpoint}/openai/deployments/${azure.deploymentName}/embeddings?api-version=${apiVersion}`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    // Use credential if provided (managed identity), otherwise use API key
    if (azure.credential) {
      const credential = azure.credential || new DefaultAzureCredential()
      const token = await credential.getToken('https://cognitiveservices.azure.com/.default')
      if (token) {
        headers['Authorization'] = `Bearer ${token.token}`
      }
    } else if (azure.apiKey) {
      headers['api-key'] = azure.apiKey
    } else {
      throw new Error('Azure OpenAI requires either credential or apiKey')
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ input: text }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Azure OpenAI API error: ${response.status} - ${error}`)
    }

    const data: any = await response.json()
    return data.data[0].embedding as number[]
  }

  private async embedOpenAI(text: string): Promise<number[]> {
    if (this.config.provider !== 'openai') {
      throw new Error('Invalid provider')
    }
    
    const { openai } = this.config
    const url = 'https://api.openai.com/v1/embeddings'

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openai.apiKey}`,
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        input: text,
        model: openai.model,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenAI API error: ${response.status} - ${error}`)
    }

    const data: any = await response.json()
    return data.data[0].embedding as number[]
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = []
    for (const text of texts) {
      embeddings.push(await this.embed(text))
    }
    return embeddings
  }
}
