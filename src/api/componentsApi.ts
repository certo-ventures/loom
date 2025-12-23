// @ts-nocheck - Legacy file, references deleted ComponentRegistry
// ============================================================================
// Component Registry REST API
// HTTP handlers for component registration and manifest retrieval
// ============================================================================

import http from 'http';
import { ComponentRegistry } from '../registry/index.js';
import { 
  ComponentMetadata, 
  ComponentManifest, 
  RegisterComponentResponse,
  UserContext 
} from '../registry/types.js';

// Dependency injection - registry will be set by server
let componentRegistry: ComponentRegistry;

export function setComponentRegistry(registry: ComponentRegistry) {
  componentRegistry = registry;
}

/**
 * Helper to read request body
 */
function readRequestBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
  });
}

/**
 * Helper to parse URL and query params
 */
function parseUrl(req: http.IncomingMessage): { pathname: string; query: URLSearchParams } {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  return {
    pathname: url.pathname,
    query: url.searchParams,
  };
}

/**
 * Helper to send JSON response
 */
function sendJson(res: http.ServerResponse, statusCode: number, data: any) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Handle component registry API requests
 * Returns true if request was handled, false if not a component API request
 */
export async function handleComponentApiRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  const { pathname, query } = parseUrl(req);
  const method = req.method?.toUpperCase() || 'GET';

  // GET /api/components/manifest - Get user's component manifest
  if (pathname === '/api/components/manifest' && method === 'GET') {
    try {
      // In production, these would come from JWT token
      // For dev, we'll accept query params
      const userId = query.get('userId') || 'dev-user';
      const tenantId = query.get('tenantId') || 'default-tenant';
      const region = query.get('region') || 'us-west';
      const locale = query.get('locale') || 'en-US';

      console.log(`[API] GET /api/components/manifest - User: ${userId}, Tenant: ${tenantId}`);

      // Build user context for URL resolution
      const context: UserContext = {
        userId,
        tenantId,
        region,
        locale,
        deviceType: query.get('deviceType') as any || 'desktop',
        subscriptionTier: query.get('subscriptionTier') as any || 'basic',
        featureFlags: query.get('featureFlags')?.split(',') || [],
        abTest: query.get('abTest') || undefined,
        roles: ['*'],  // In production, fetch from auth service
      };

      // Get manifest with resolved URLs
      const result = await componentRegistry.getUserManifest(context);

      // Build manifest response
      const manifest: ComponentManifest = {
        userId,
        tenantId,
        components: result.components,
        timestamp: new Date().toISOString(),
      };

      console.log(`[API] Returning ${result.components.length} components to user ${userId}`);

      sendJson(res, 200, manifest);
    } catch (error) {
      console.error('[API] Error getting manifest:', error);
      sendJson(res, 500, {
        error: 'Failed to load component manifest',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
    return true;
  }

  // POST /api/components/register - Register a new component
  if (pathname === '/api/components/register' && method === 'POST') {
    try {
      const body = await readRequestBody(req);
      const component: ComponentMetadata = JSON.parse(body);
      const tenantId = query.get('tenantId') || 'default-tenant';

      console.log(`[API] POST /api/components/register - Component: ${component.name} (${component.type})`);

      // Set tenant ID
      component.tenantId = tenantId;

      // Register component
      await componentRegistry.registerComponent(component);

      const response: RegisterComponentResponse = {
        success: true,
        id: component.id,
        message: `Component ${component.name} registered successfully`,
      };

      sendJson(res, 201, response);
    } catch (error) {
      console.error('[API] Error registering component:', error);
      sendJson(res, 400, {
        error: 'Failed to register component',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
    return true;
  }

  // GET /api/components/:id - Get component by ID
  if (pathname.startsWith('/api/components/') && method === 'GET' && pathname !== '/api/components/manifest') {
    const id = pathname.replace('/api/components/', '');
    
    try {
      console.log(`[API] GET /api/components/${id}`);

      const component = await componentRegistry.getComponentById(id);

      if (!component) {
        sendJson(res, 404, {
          error: 'Component not found',
          id,
        });
        return true;
      }

      sendJson(res, 200, component);
    } catch (error) {
      console.error('[API] Error getting component:', error);
      sendJson(res, 500, {
        error: 'Failed to load component',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
    return true;
  }

  // DELETE /api/components/:id - Delete component
  if (pathname.startsWith('/api/components/') && method === 'DELETE') {
    const id = pathname.replace('/api/components/', '');
    
    try {
      console.log(`[API] DELETE /api/components/${id}`);

      await componentRegistry.deleteComponent(id);

      sendJson(res, 200, {
        success: true,
        message: `Component ${id} deleted successfully`,
      });
    } catch (error) {
      console.error('[API] Error deleting component:', error);
      sendJson(res, 400, {
        error: 'Failed to delete component',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
    return true;
  }

  // Not a component API request
  return false;
}
