import { describe, it, expect } from 'vitest'
import type { ActivityStore } from '../../storage/activity-store'
import type { ActivityDefinition } from '../../activities/wasm-executor'

/**
 * Unit tests for ActivityStore interface
 * These tests work with any ActivityStore implementation
 */
export function testActivityStore(createStore: () => Promise<ActivityStore>) {
  describe('ActivityStore', () => {
    it('should save and resolve an activity', async () => {
      const store = await createStore()

      const definition: ActivityDefinition = {
        name: 'email-sender',
        version: '1.0.0',
        wasmBlobPath: 'activities/email-sender-1.0.0.wasm',
        limits: {
          maxMemoryMB: 128,
          maxExecutionMs: 5000,
        },
      }

      await store.save(definition)
      const resolved = await store.resolve('email-sender', '1.0.0')

      expect(resolved.name).toBe(definition.name)
      expect(resolved.version).toBe(definition.version)
      expect(resolved.wasmBlobPath).toBe(definition.wasmBlobPath)
    })

    it('should resolve latest version when version not specified', async () => {
      const store = await createStore()

      const v1: ActivityDefinition = {
        name: 'calculator',
        version: '1.0.0',
        wasmBlobPath: 'calc-1.0.0.wasm',
        limits: { maxMemoryMB: 64, maxExecutionMs: 1000 },
      }

      const v2: ActivityDefinition = {
        name: 'calculator',
        version: '2.0.0',
        wasmBlobPath: 'calc-2.0.0.wasm',
        limits: { maxMemoryMB: 128, maxExecutionMs: 2000 },
      }

      await store.save(v1)
      await store.save(v2)

      const resolved = await store.resolve('calculator')
      expect(resolved.version).toBe('2.0.0')
    })

    it('should throw error when activity not found', async () => {
      const store = await createStore()

      await expect(store.resolve('unknown')).rejects.toThrow('not found')
      await expect(store.resolve('unknown', '1.0.0')).rejects.toThrow('not found')
    })

    it('should list all activities', async () => {
      const store = await createStore()

      const def1: ActivityDefinition = {
        name: 'activity1',
        version: '1.0.0',
        wasmBlobPath: 'a1.wasm',
        limits: { maxMemoryMB: 64, maxExecutionMs: 1000 },
      }

      const def2: ActivityDefinition = {
        name: 'activity2',
        version: '1.0.0',
        wasmBlobPath: 'a2.wasm',
        limits: { maxMemoryMB: 128, maxExecutionMs: 2000 },
      }

      await store.save(def1)
      await store.save(def2)

      const all = await store.list()
      expect(all.length).toBeGreaterThanOrEqual(2)
      
      const names = all.map(a => a.name)
      expect(names).toContain('activity1')
      expect(names).toContain('activity2')
    })

    it('should check if activity exists', async () => {
      const store = await createStore()

      const definition: ActivityDefinition = {
        name: 'checker',
        version: '1.0.0',
        wasmBlobPath: 'checker.wasm',
        limits: { maxMemoryMB: 64, maxExecutionMs: 1000 },
      }

      await store.save(definition)

      expect(await store.exists('checker', '1.0.0')).toBe(true)
      expect(await store.exists('checker')).toBe(true)
      expect(await store.exists('checker', '2.0.0')).toBe(false)
      expect(await store.exists('unknown')).toBe(false)
    })

    it('should delete an activity', async () => {
      const store = await createStore()

      const definition: ActivityDefinition = {
        name: 'temp',
        version: '1.0.0',
        wasmBlobPath: 'temp.wasm',
        limits: { maxMemoryMB: 64, maxExecutionMs: 1000 },
      }

      await store.save(definition)
      expect(await store.exists('temp', '1.0.0')).toBe(true)

      await store.delete('temp', '1.0.0')
      expect(await store.exists('temp', '1.0.0')).toBe(false)
    })

    it('should handle multiple versions of same activity', async () => {
      const store = await createStore()

      const v1: ActivityDefinition = {
        name: 'api-client',
        version: '1.0.0',
        wasmBlobPath: 'api-v1.wasm',
        limits: { maxMemoryMB: 64, maxExecutionMs: 1000 },
      }

      const v2: ActivityDefinition = {
        name: 'api-client',
        version: '2.0.0',
        wasmBlobPath: 'api-v2.wasm',
        limits: { maxMemoryMB: 128, maxExecutionMs: 2000 },
      }

      await store.save(v1)
      await store.save(v2)

      const resolved1 = await store.resolve('api-client', '1.0.0')
      const resolved2 = await store.resolve('api-client', '2.0.0')

      expect(resolved1.version).toBe('1.0.0')
      expect(resolved2.version).toBe('2.0.0')
      expect(resolved1.wasmBlobPath).toBe('api-v1.wasm')
      expect(resolved2.wasmBlobPath).toBe('api-v2.wasm')
    })

    it('should update activity on duplicate save', async () => {
      const store = await createStore()

      const original: ActivityDefinition = {
        name: 'updatable',
        version: '1.0.0',
        wasmBlobPath: 'old-path.wasm',
        limits: { maxMemoryMB: 64, maxExecutionMs: 1000 },
      }

      await store.save(original)

      const updated: ActivityDefinition = {
        name: 'updatable',
        version: '1.0.0',
        wasmBlobPath: 'new-path.wasm',
        limits: { maxMemoryMB: 128, maxExecutionMs: 2000 },
      }

      await store.save(updated)

      const resolved = await store.resolve('updatable', '1.0.0')
      expect(resolved.wasmBlobPath).toBe('new-path.wasm')
      expect(resolved.limits?.maxMemoryMB).toBe(128)
    })
  })
}
