/**
 * Simplified State API - Motia-inspired key-value interface
 * 
 * Sits on top of the journal system to provide easy state management
 * for common cases while preserving full journal power for advanced scenarios.
 */

/**
 * Simple key-value state API
 */
export interface SimpleState {
  /**
   * Get a value from state
   */
  get<T = unknown>(key: string): T | undefined
  
  /**
   * Set a value in state
   */
  set(key: string, value: unknown): void
  
  /**
   * Delete a key from state
   */
  delete(key: string): void
  
  /**
   * Clear all state
   */
  clear(): void
  
  /**
   * Check if key exists
   */
  has(key: string): boolean
  
  /**
   * Get all keys
   */
  keys(): string[]
  
  /**
   * Get all entries
   */
  entries(): [string, unknown][]
}

/**
 * Implementation of SimpleState that wraps actor state
 */
export class SimpleStateImpl implements SimpleState {
  constructor(
    private getState: () => Record<string, unknown>,
    private setState: (newState: Record<string, unknown>) => void
  ) {}

  get<T = unknown>(key: string): T | undefined {
    return this.getState()[key] as T | undefined
  }

  set(key: string, value: unknown): void {
    const state = this.getState()
    this.setState({ ...state, [key]: value })
  }

  delete(key: string): void {
    const state = this.getState()
    const { [key]: _, ...newState } = state
    this.setState(newState)
  }

  clear(): void {
    this.setState({})
  }

  has(key: string): boolean {
    return key in this.getState()
  }

  keys(): string[] {
    return Object.keys(this.getState())
  }

  entries(): [string, unknown][] {
    return Object.entries(this.getState())
  }
}
