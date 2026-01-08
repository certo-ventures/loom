/**
 * Error Handler Middleware
 */

import { Request, Response, NextFunction } from 'express'
import { logger } from '../utils/logger'

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  logger.error('Error handling request', {
    error: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method
  })
  
  if (error instanceof ApiError) {
    return res.status(error.statusCode).json({
      error: error.message,
      code: error.code
    })
  }
  
  // Default to 500 for unexpected errors
  res.status(500).json({
    error: 'Internal server error'
  })
}
