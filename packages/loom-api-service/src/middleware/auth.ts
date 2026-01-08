/**
 * Authentication Middleware
 */

import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { config } from '../config'
import { logger } from '../utils/logger'

export interface AuthUser {
  userId: string
  tenantId?: string
  role: string
  permissions: string[]
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
      tenantId?: string
    }
  }
}

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Skip auth for health and docs
  if (req.path === '/api/v1/health' || req.path.startsWith('/docs')) {
    return next()
  }
  
  const authHeader = req.headers.authorization
  const apiKey = req.headers['x-api-key'] as string
  
  // API Key authentication
  if (apiKey) {
    // TODO: Validate API key against database
    req.user = {
      userId: 'api-key-user',
      role: 'api',
      permissions: ['*']
    }
    return next()
  }
  
  // JWT authentication
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7)
    
    try {
      const decoded = jwt.verify(token, config.jwt.secret) as AuthUser
      req.user = decoded
      return next()
    } catch (error) {
      logger.warn('Invalid JWT token', { error })
      return res.status(401).json({ error: 'Invalid token' })
    }
  }
  
  // Allow unauthenticated access for now (development)
  if (config.env === 'development') {
    req.user = {
      userId: 'dev-user',
      role: 'admin',
      permissions: ['*']
    }
    return next()
  }
  
  return res.status(401).json({ error: 'Authentication required' })
}
