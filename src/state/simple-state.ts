/**
 * Simplified State API - Motia-inspired key-value interface
 * 
 * Sits on top of the journal system to provide easy state management
 * for common cases while preserving full journal power for advanced scenarios.
 */

type MaybePromise<T> = T | Promise<T>

/**
 * Simple key-value state API with async semantics
 */
export interface SimpleState {
  /**
   * Get a value from state
   */
  get<T = unknown>(key: string): Promise<T | undefined>
  
  /**
   * Set a value in state
   */
  set(key: string, value: unknown): Promise<void>
  
  /**
   * Delete a key from state
   */
  delete(key: string): Promise<void>
  
  /**
   * Clear all state
   */
  clear(): Promise<void>
  
  /**
   * Check if key exists
   */
  has(key: string): Promise<boolean>
  
  /**
   * Get all keys
   */
  keys(): Promise<string[]>
  
  /**
   * Get all entries
   */
  entries(): Promise<[string, unknown][]>
}

/**
 * Implementation of SimpleState that wraps actor state
 */
export class SimpleStateImpl implements SimpleState {
  constructor(
    private readonly getState: () => MaybePromise<Record<string, unknown>>,
    private readonly setState: (newState: Record<string, unknown>) => MaybePromise<void>
  ) {}

  private async snapshot(): Promise<Record<string, unknown>> {
    return await this.getState()
  }

  private async commit(next: Record<string, unknown>): Promise<void> {
    await this.setState(next)
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const state = await this.snapshot()
    return state[key] as T | undefined
  }

  async set(key: string, value: unknown): Promise<void> {
    const state = await this.snapshot()
    await this.commit({ ...state, [key]: value })
  }

  async delete(key: string): Promise<void> {
    const state = await this.snapshot()
    const { [key]: _, ...newState } = state
    await this.commit(newState)
  }

  async clear(): Promise<void> {
    await this.commit({})
  }

  async has(key: string): Promise<boolean> {
    const state = await this.snapshot()
    return key in state
  }

  async keys(): Promise<string[]> {
    const state = await this.snapshot()
    return Object.keys(state)
  }

  async entries(): Promise<[string, unknown][]> {
    const state = await this.snapshot()
    return Object.entries(state)
  }
}
