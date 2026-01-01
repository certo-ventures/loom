/**
 * Tests for TLS Notary Production Readiness
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createVerifier,
  healthCheck,
  validateProductionReadiness,
  loadTLSNotaryConfigFromEnv,
  ProductionReadinessError,
} from '../../tlsnotary/production'
import type { TLSNotaryConfig } from '../../tlsnotary/production'

describe('TLS Notary Production', () => {
  describe('createVerifier', () => {
    it('should create verifier in development mode with allowMock', async () => {
      const config: TLSNotaryConfig = {
        mode: 'development',
        allowMock: true,
      }

      const verifier = await createVerifier(config)
      expect(verifier).toBeDefined()
      // Should fall back to mock since WASM not built in test env
      const info = verifier.getInfo()
      expect(info.type).toBe('mock')
    })

    it('should throw ProductionReadinessError if mock disallowed in production', async () => {
      const config: TLSNotaryConfig = {
        mode: 'production',
        allowMock: true, // Not allowed!
      }

      await expect(createVerifier(config)).rejects.toThrow(ProductionReadinessError)
      await expect(createVerifier(config)).rejects.toThrow('Mock verifier is not allowed in production mode')
    })

    it('should try WASM in production mode', async () => {
      const config: TLSNotaryConfig = {
        mode: 'production',
        allowMock: false,
      }

      // This will fail because WASM is not built in test env
      await expect(createVerifier(config)).rejects.toThrow(ProductionReadinessError)
      await expect(createVerifier(config)).rejects.toThrow('WASM verifier required in production')
    })
  })

  describe('healthCheck', () => {
    it('should return health status for development mode', async () => {
      const config: TLSNotaryConfig = {
        mode: 'development',
        allowMock: true,
      }

      const health = await healthCheck(config)

      expect(health).toBeDefined()
      expect(health.verifierType).toBeDefined()
      expect(health.ready).toBeDefined()
    })

    it('should return error for production without WASM', async () => {
      const config: TLSNotaryConfig = {
        mode: 'production',
        allowMock: false,
      }

      const health = await healthCheck(config)

      expect(health.healthy).toBe(false)
      expect(health.error).toBeDefined()
    })
  })

  describe('validateProductionReadiness', () => {
    it('should pass validation for non-production modes', async () => {
      const config: TLSNotaryConfig = {
        mode: 'development',
        allowMock: true,
      }

      await expect(validateProductionReadiness(config)).resolves.toBeUndefined()
    })

    it('should throw for production mode without WASM', async () => {
      const config: TLSNotaryConfig = {
        mode: 'production',
        allowMock: false,
      }

      await expect(validateProductionReadiness(config)).rejects.toThrow(ProductionReadinessError)
      await expect(validateProductionReadiness(config)).rejects.toThrow('not ready for production')
    })
  })

  describe('loadTLSNotaryConfigFromEnv', () => {
    const originalEnv = process.env

    beforeEach(() => {
      process.env = { ...originalEnv }
    })

    afterEach(() => {
      process.env = originalEnv
    })

    it('should load production config from environment', () => {
      process.env.NODE_ENV = 'production'
      process.env.TLSNOTARY_ALLOW_MOCK = 'false'

      const config = loadTLSNotaryConfigFromEnv()

      expect(config.mode).toBe('production')
      expect(config.allowMock).toBe(false)
    })

    it('should load development config from environment', () => {
      process.env.NODE_ENV = 'development'

      const config = loadTLSNotaryConfigFromEnv()

      expect(config.mode).toBe('development')
    })

    it('should default to development mode if NODE_ENV not set', () => {
      delete process.env.NODE_ENV

      const config = loadTLSNotaryConfigFromEnv()

      expect(config.mode).toBe('development')
    })

    it('should parse TLSNOTARY_ALLOW_MOCK', () => {
      process.env.TLSNOTARY_ALLOW_MOCK = 'true'

      const config = loadTLSNotaryConfigFromEnv()

      expect(config.allowMock).toBe(true)
    })

    it('should parse trusted notaries list', () => {
      process.env.TLSNOTARY_TRUSTED_NOTARIES = 'key1,key2,key3'

      const config = loadTLSNotaryConfigFromEnv()

      expect(config.trustedNotaries).toEqual(['key1', 'key2', 'key3'])
    })

    it('should parse max presentation age', () => {
      process.env.TLSNOTARY_MAX_PRESENTATION_AGE = '3600'

      const config = loadTLSNotaryConfigFromEnv()

      expect(config.maxPresentationAge).toBe(3600)
    })
  })

  describe('ProductionReadinessError', () => {
    it('should extend Error', () => {
      const error = new ProductionReadinessError('test error')

      expect(error).toBeInstanceOf(Error)
      expect(error.name).toBe('ProductionReadinessError')
      expect(error.message).toBe('test error')
    })
  })
})
