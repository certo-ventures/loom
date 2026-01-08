/**
 * Express Middleware Setup
 */

import express, { Express } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import type { Config } from '../config'
import { authMiddleware } from './auth'
import { tenantMiddleware } from './tenant'
import { requestLogger } from './request-logger'
import { errorHandler } from './error-handler'

export function setupMiddleware(app: Express, config: Config) {
  // Security headers
  app.use(helmet())
  
  // CORS
  app.use(cors({
    origin: config.cors.origin,
    credentials: config.cors.credentials
  }))
  
  // Body parsing
  app.use(express.json({ limit: '10mb' }))
  app.use(express.urlencoded({ extended: true, limit: '10mb' }))
  
  // Request logging
  app.use(requestLogger)
  
  // Rate limiting
  const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many requests, please try again later'
  })
  app.use('/api/', limiter)
  
  // Authentication (optional for some routes)
  app.use('/api/', authMiddleware)
  
  // Multi-tenancy
  if (config.multitenancy.enabled) {
    app.use('/api/', tenantMiddleware(config.multitenancy.defaultTenant))
  }
  
  // Error handler (must be last)
  app.use(errorHandler)
}
