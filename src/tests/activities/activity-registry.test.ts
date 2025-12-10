import { describe, it, expect, beforeEach } from 'vitest'
import { ActivityRegistry } from '../../activities/activity-registry'
import type { ActivityDefinition } from '../../activities/types'

describe('ActivityRegistry', () => {
  let registry: ActivityRegistry

  beforeEach(() => {
    registry = new ActivityRegistry()
  })

  it('should register and resolve an activity', () => {
    const definition: ActivityDefinition = {
      name: 'email-sender',
      version: '1.0.0',
      wasmBlobPath: 'activities/email-sender-1.0.0.wasm',
      limits: {
        maxMemoryMB: 128,
        maxExecutionMs: 5000,
      }
    }

    registry.register(definition)
    const resolved = registry.resolve('email-sender', '1.0.0')

    expect(resolved).toEqual(definition)
  })

  it('should resolve latest version when no version specified', () => {
    const v1: ActivityDefinition = {
      name: 'calculator',
      version: '1.0.0',
      wasmBlobPath: 'calc-1.0.0.wasm',
      limits: { maxMemoryMB: 64, maxExecutionMs: 1000 }
    }

    const latest: ActivityDefinition = {
      name: 'calculator',
      version: 'latest',
      wasmBlobPath: 'calc-2.0.0.wasm',
      limits: { maxMemoryMB: 64, maxExecutionMs: 1000 }
    }

    registry.register(v1)
    registry.register(latest)

    const resolved = registry.resolve('calculator')
    expect(resolved).toEqual(latest)
  })

  it('should resolve any version if latest not found', () => {
    const definition: ActivityDefinition = {
      name: 'analyzer',
      version: '0.5.0',
      wasmBlobPath: 'analyzer.wasm',
      limits: { maxMemoryMB: 256, maxExecutionMs: 10000 }
    }

    registry.register(definition)
    const resolved = registry.resolve('analyzer')

    expect(resolved).toEqual(definition)
  })

  it('should throw error when activity not found', () => {
    expect(() => registry.resolve('unknown')).toThrow('Activity unknown not found')
    expect(() => registry.resolve('unknown', '1.0.0')).toThrow('Activity unknown@1.0.0 not found')
  })

  it('should list all registered activities', () => {
    const def1: ActivityDefinition = {
      name: 'activity1',
      version: '1.0.0',
      wasmBlobPath: 'a1.wasm',
      limits: { maxMemoryMB: 64, maxExecutionMs: 1000 }
    }

    const def2: ActivityDefinition = {
      name: 'activity2',
      version: '2.0.0',
      wasmBlobPath: 'a2.wasm',
      limits: { maxMemoryMB: 128, maxExecutionMs: 2000 }
    }

    registry.register(def1)
    registry.register(def2)

    const all = registry.list()
    expect(all).toHaveLength(2)
    expect(all).toContainEqual(def1)
    expect(all).toContainEqual(def2)
  })

  it('should check if activity exists', () => {
    const definition: ActivityDefinition = {
      name: 'checker',
      version: '1.0.0',
      wasmBlobPath: 'checker.wasm',
      limits: { maxMemoryMB: 64, maxExecutionMs: 1000 }
    }

    registry.register(definition)

    expect(registry.has('checker', '1.0.0')).toBe(true)
    expect(registry.has('checker')).toBe(true)
    expect(registry.has('checker', '2.0.0')).toBe(false)
    expect(registry.has('unknown')).toBe(false)
  })

  it('should unregister an activity', () => {
    const definition: ActivityDefinition = {
      name: 'temp',
      version: '1.0.0',
      wasmBlobPath: 'temp.wasm',
      limits: { maxMemoryMB: 64, maxExecutionMs: 1000 }
    }

    registry.register(definition)
    expect(registry.has('temp', '1.0.0')).toBe(true)

    const removed = registry.unregister('temp', '1.0.0')
    expect(removed).toBe(true)
    expect(registry.has('temp', '1.0.0')).toBe(false)
  })

  it('should clear all registrations', () => {
    registry.register({
      name: 'a1',
      version: '1.0.0',
      wasmBlobPath: 'a1.wasm',
      limits: { maxMemoryMB: 64, maxExecutionMs: 1000 }
    })

    registry.register({
      name: 'a2',
      version: '1.0.0',
      wasmBlobPath: 'a2.wasm',
      limits: { maxMemoryMB: 64, maxExecutionMs: 1000 }
    })

    expect(registry.list()).toHaveLength(2)

    registry.clear()
    expect(registry.list()).toHaveLength(0)
  })

  it('should handle multiple versions of same activity', () => {
    const v1: ActivityDefinition = {
      name: 'api-client',
      version: '1.0.0',
      wasmBlobPath: 'api-v1.wasm',
      limits: { maxMemoryMB: 64, maxExecutionMs: 1000 }
    }

    const v2: ActivityDefinition = {
      name: 'api-client',
      version: '2.0.0',
      wasmBlobPath: 'api-v2.wasm',
      limits: { maxMemoryMB: 128, maxExecutionMs: 2000 }
    }

    registry.register(v1)
    registry.register(v2)

    expect(registry.resolve('api-client', '1.0.0')).toEqual(v1)
    expect(registry.resolve('api-client', '2.0.0')).toEqual(v2)
  })
})
