/**
 * Tests for WASM Capabilities - Security model and timeout enforcement
 */

import { describe, it, expect, vi } from 'vitest'
import {
  DEFAULT_CAPABILITIES,
  validateCapabilities,
  createExecutionContext,
  checkTimeout,
  validateManifest,
  TimeoutError,
  CapabilityError,
} from '../../wasm/capabilities'
import type { WasmCapabilities, WasmManifest } from '../../wasm/capabilities'

describe('WASM Capabilities', () => {
  describe('DEFAULT_CAPABILITIES', () => {
    it('should provide safe defaults', () => {
      expect(DEFAULT_CAPABILITIES.network).toBe(false)
      expect(DEFAULT_CAPABILITIES.filesystem).toBe(false)
      expect(DEFAULT_CAPABILITIES.env).toBe(false)
      expect(DEFAULT_CAPABILITIES.random).toBe(true)
      expect(DEFAULT_CAPABILITIES.time).toBe(true)
      expect(DEFAULT_CAPABILITIES.timeout).toBe(5000)
      expect(DEFAULT_CAPABILITIES.maxMemoryMB).toBe(64)
      expect(DEFAULT_CAPABILITIES.hostFunctions).toEqual([])
    })
  })

  describe('validateCapabilities', () => {
    it('should allow when requested is within allowed limits', () => {
      const requested: WasmCapabilities = {
        network: false,
        filesystem: false,
      }
      const allowed: WasmCapabilities = {
        ...DEFAULT_CAPABILITIES,
      }

      expect(() => validateCapabilities(requested, allowed)).not.toThrow()
    })

    it('should block network when not allowed', () => {
      const requested: WasmCapabilities = {
        network: true,
      }
      const allowed = DEFAULT_CAPABILITIES

      expect(() => validateCapabilities(requested, allowed))
        .toThrow(CapabilityError)
      expect(() => validateCapabilities(requested, allowed))
        .toThrow('Network access not permitted')
    })

    it('should block filesystem when not allowed', () => {
      const requested: WasmCapabilities = {
        filesystem: true,
      }
      const allowed = DEFAULT_CAPABILITIES

      expect(() => validateCapabilities(requested, allowed))
        .toThrow(CapabilityError)
      expect(() => validateCapabilities(requested, allowed))
        .toThrow('Filesystem access not permitted')
    })

    it('should block environment variables when not allowed', () => {
      const requested: WasmCapabilities = {
        env: true,
      }
      const allowed = DEFAULT_CAPABILITIES

      expect(() => validateCapabilities(requested, allowed))
        .toThrow(CapabilityError)
      expect(() => validateCapabilities(requested, allowed))
        .toThrow('Environment variable access not permitted')
    })

    it('should allow network when explicitly enabled', () => {
      const requested: WasmCapabilities = {
        network: true,
      }
      const allowed: WasmCapabilities = {
        ...DEFAULT_CAPABILITIES,
        network: true,
      }

      expect(() => validateCapabilities(requested, allowed)).not.toThrow()
    })

    it('should block excessive memory requests', () => {
      const requested: WasmCapabilities = {
        maxMemoryMB: 128,
      }
      const allowed: WasmCapabilities = {
        ...DEFAULT_CAPABILITIES,
        maxMemoryMB: 64,
      }

      expect(() => validateCapabilities(requested, allowed))
        .toThrow(CapabilityError)
      expect(() => validateCapabilities(requested, allowed))
        .toThrow('Memory limit exceeded')
    })

    it('should block excessive timeout requests', () => {
      const requested: WasmCapabilities = {
        timeout: 10000,
      }
      const allowed: WasmCapabilities = {
        ...DEFAULT_CAPABILITIES,
        timeout: 5000,
      }

      expect(() => validateCapabilities(requested, allowed))
        .toThrow(CapabilityError)
      expect(() => validateCapabilities(requested, allowed))
        .toThrow('Timeout limit exceeded')
    })
  })

  describe('createExecutionContext', () => {
    it('should create context with capabilities', () => {
      const capabilities = DEFAULT_CAPABILITIES
      const context = createExecutionContext(capabilities, 5000)

      expect(context.capabilities).toBeDefined()
      expect(context.startTime).toBeGreaterThan(0)
      expect(context.timeout).toBe(5000)
      expect(context.abortSignal).toBeDefined()
    })

    it('should use default timeout if not specified', () => {
      const capabilities = DEFAULT_CAPABILITIES
      const context = createExecutionContext(capabilities)

      expect(context.timeout).toBe(DEFAULT_CAPABILITIES.timeout)
    })
  })

  describe('checkTimeout', () => {
    it('should not throw if within timeout', () => {
      const capabilities = DEFAULT_CAPABILITIES
      const context = createExecutionContext(capabilities, 1000)

      expect(() => checkTimeout(context)).not.toThrow()
    })

    it('should throw TimeoutError if exceeded', async () => {
      const capabilities = DEFAULT_CAPABILITIES
      const context = createExecutionContext(capabilities, 10) // 10ms timeout

      // Wait for timeout to expire
      await new Promise(resolve => setTimeout(resolve, 20))

      expect(() => checkTimeout(context)).toThrow(TimeoutError)
      expect(() => checkTimeout(context)).toThrow('Execution timed out after')
    })

    it('should throw on aborted signal', async () => {
      const capabilities = DEFAULT_CAPABILITIES
      const context = createExecutionContext(capabilities, 10)

      await new Promise(resolve => setTimeout(resolve, 20))

      try {
        checkTimeout(context)
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(TimeoutError)
      }
    })
  })

  describe('validateManifest', () => {
    const allowed = DEFAULT_CAPABILITIES

    it('should validate basic manifest', () => {
      const manifest: WasmManifest = {
        name: 'test-module',
        version: '1.0.0',
        description: 'Test module',
        capabilities: DEFAULT_CAPABILITIES,
        exports: ['add', 'subtract'],
      }

      expect(() => validateManifest(manifest, allowed)).not.toThrow()
    })

    it('should throw on missing name', () => {
      const manifest: any = {
        version: '1.0.0',
        capabilities: DEFAULT_CAPABILITIES,
      }

      expect(() => validateManifest(manifest, allowed))
        .toThrow('Manifest missing required field: name')
    })

    it('should throw on missing version', () => {
      const manifest: any = {
        name: 'test-module',
        capabilities: DEFAULT_CAPABILITIES,
      }

      expect(() => validateManifest(manifest, allowed))
        .toThrow('Manifest missing required field: version')
    })

    it('should throw on missing capabilities', () => {
      const manifest: any = {
        name: 'test-module',
        version: '1.0.0',
      }

      expect(() => validateManifest(manifest, allowed))
        .toThrow('Manifest missing required field: capabilities')
    })

    it('should validate exports if provided', () => {
      const manifest: WasmManifest = {
        name: 'test-module',
        version: '1.0.0',
        capabilities: DEFAULT_CAPABILITIES,
        exports: ['add'],
      }

      expect(() => validateManifest(manifest, allowed)).not.toThrow()
    })

    it('should allow optional description', () => {
      const manifest: WasmManifest = {
        name: 'test-module',
        version: '1.0.0',
        capabilities: DEFAULT_CAPABILITIES,
      }

      expect(() => validateManifest(manifest, allowed)).not.toThrow()
    })

    it('should validate nested capabilities', () => {
      const manifest: WasmManifest = {
        name: 'test-module',
        version: '1.0.0',
        capabilities: {
          ...DEFAULT_CAPABILITIES,
          filesystem: true,
        },
      }

      const allowedWithFs: WasmCapabilities = {
        ...DEFAULT_CAPABILITIES,
        filesystem: true,
      }

      expect(() => validateManifest(manifest, allowedWithFs)).not.toThrow()
    })

    it('should reject excessive timeout', () => {
      const manifest: WasmManifest = {
        name: 'test-module',
        version: '1.0.0',
        capabilities: {
          ...DEFAULT_CAPABILITIES,
          timeout: 10000,
        }
      }

      expect(() => validateManifest(manifest, allowed))
        .toThrow(CapabilityError)
      expect(() => validateManifest(manifest, allowed))
        .toThrow('Timeout limit exceeded')
    })

    it('should reject excessive memory limit', () => {
      const manifest: WasmManifest = {
        name: 'test-module',
        version: '1.0.0',
        capabilities: {
          ...DEFAULT_CAPABILITIES,
          maxMemoryMB: 256,
        }
      }

      expect(() => validateManifest(manifest, allowed))
        .toThrow(CapabilityError)
      expect(() => validateManifest(manifest, allowed))
        .toThrow('Memory limit exceeded')
    })
  })

  describe('CapabilityError', () => {
    it('should extend Error', () => {
      const error = new CapabilityError('Network access not permitted')

      expect(error).toBeInstanceOf(Error)
      expect(error.name).toBe('CapabilityError')
      expect(error.message).toBe('Network access not permitted')
    })
  })

  describe('TimeoutError', () => {
    it('should extend Error', () => {
      const error = new TimeoutError('Execution timed out')

      expect(error).toBeInstanceOf(Error)
      expect(error.name).toBe('TimeoutError')
      expect(error.message).toBe('Execution timed out')
    })
  })
})
