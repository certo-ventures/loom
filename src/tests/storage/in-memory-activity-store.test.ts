import { describe, beforeEach } from 'vitest'
import { InMemoryActivityStore } from '../../storage/in-memory-activity-store'
import { testActivityStore } from './activity-store-tests'

/**
 * Unit tests for InMemoryActivityStore
 */
describe('InMemoryActivityStore', () => {
  let store: InMemoryActivityStore

  beforeEach(() => {
    store = new InMemoryActivityStore()
  })

  // Run all the standard ActivityStore tests
  testActivityStore(async () => {
    store.clear() // Clean slate for each test
    return store
  })
})
