import { describe, it, expect } from 'vitest'
import type { StateStore, MessageQueue, BlobStore, LockManager } from './index'

describe('Storage Interfaces', () => {
  it('should define StateStore interface', () => {
    // This test just verifies the interface compiles
    const mockStore: StateStore = {
      save: async () => {},
      load: async () => null,
      delete: async () => {},
      query: async () => [],
    }

    expect(mockStore).toBeDefined()
  })

  it('should define MessageQueue interface', () => {
    const mockQueue: MessageQueue = {
      enqueue: async () => {},
      dequeue: async () => null,
      ack: async () => {},
      nack: async () => {},
      deadLetter: async () => {},
    }

    expect(mockQueue).toBeDefined()
  })

  it('should define BlobStore interface', () => {
    const mockBlob: BlobStore = {
      upload: async () => '',
      download: async () => Buffer.from(''),
      exists: async () => false,
      delete: async () => {},
    }

    expect(mockBlob).toBeDefined()
  })

  it('should define LockManager interface', () => {
    const mockLock: LockManager = {
      acquire: async () => null,
      release: async () => {},
      extend: async () => {},
    }

    expect(mockLock).toBeDefined()
  })
})
