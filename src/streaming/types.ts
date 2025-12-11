/**
 * Streaming types for progressive output
 */

/**
 * Stream chunk types
 */
export type StreamChunkType = 'start' | 'progress' | 'data' | 'complete' | 'error'

/**
 * Progress information
 */
export interface StreamProgress {
  current: number
  total: number
  message?: string
}

/**
 * Stream chunk - unit of streaming output
 */
export interface StreamChunk {
  type: StreamChunkType
  data?: any
  error?: Error
  progress?: StreamProgress
}
