/**
 * Tenant Middleware
 */

import { Request, Response, NextFunction } from 'express'

export const tenantMiddleware = (defaultTenant: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Extract tenant from header, subdomain, or use default
    const tenantHeader = req.headers['x-tenant-id'] as string
    const tenantFromUser = req.user?.tenantId
    
    req.tenantId = tenantHeader || tenantFromUser || defaultTenant
    
    next()
  }
}
