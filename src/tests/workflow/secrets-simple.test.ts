/**
 * Tests for Workflow Secrets Integration
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryWorkflowExecutor, WorkflowDefinition } from '../../workflow/index.js';
import { InMemorySecretsClient } from '../../secrets/in-memory-secrets.js';

describe('Workflow Secrets', () => {
  let executor: InMemoryWorkflowExecutor;
  let secretsClient: InMemorySecretsClient;

  beforeEach(async () => {
    // Create secrets client with test secrets
    secretsClient = new InMemorySecretsClient({
      'api-key': 'test-secret-key-123',
      'db-password': 'super-secure-pwd',
    });

    executor = new InMemoryWorkflowExecutor({
      secretsClient,
    });
  });

  describe('@secret() Expression', () => {
    it('should retrieve secret value in Compose action', async () => {
      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: {
          manual: { type: 'manual' }
        },
        actions: {
          getSecret: {
            type: 'Compose',
            inputs: "@secret('api-key')",
          },
        },
      };

      const instanceId = await executor.execute(workflow, {});
      const result = await executor.waitForCompletion(instanceId);
      expect(result.getSecret).toBe('test-secret-key-123');
    });

    it('should use secrets in object properties', async () => {
      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: {
          manual: { type: 'manual' }
        },
        actions: {
          buildConfig: {
            type: 'Compose',
            inputs: {
              apiKey: "@secret('api-key')",
              password: "@secret('db-password')",
            },
          },
        },
      };

      const instanceId = await executor.execute(workflow, {});
      const result = await executor.waitForCompletion(instanceId);
      expect(result.buildConfig.apiKey).toBe('test-secret-key-123');
      expect(result.buildConfig.password).toBe('super-secure-pwd');
    });

    it('should throw error if secret not found', async () => {
      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: {
          manual: { type: 'manual' }
        },
        actions: {
          getSecret: {
            type: 'Compose',
            inputs: "@secret('non-existent')",
          },
        },
      };

      const instanceId = await executor.execute(workflow, {});
      const result = await executor.waitForCompletion(instanceId);
      
      // Workflow should fail with error message
      expect(result).toContain('Secret not found');
    });

    it('should throw error if secrets client not configured', async () => {
      const noSecretsExecutor = new InMemoryWorkflowExecutor({});

      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: {
          manual: { type: 'manual' }
        },
        actions: {
          getSecret: {
            type: 'Compose',
            inputs: "@secret('api-key')",
          },
        },
      };

      const instanceId = await noSecretsExecutor.execute(workflow, {});
      const result = await noSecretsExecutor.waitForCompletion(instanceId);
      
      // Workflow should fail with error about no secrets client
      expect(result).toContain('No secrets client configured');
    });
  });

  describe('Secrets Client', () => {
    it('should get and set secrets', async () => {
      const secret = await secretsClient.getSecret('api-key');
      expect(secret.value).toBe('test-secret-key-123');
      expect(secret.name).toBe('api-key');

      await secretsClient.setSecret('new-key', 'new-value');
      const newSecret = await secretsClient.getSecret('new-key');
      expect(newSecret.value).toBe('new-value');
    });

    it('should support secret versioning', async () => {
      // Create a new secret for versioning test
      await secretsClient.setSecret('versioned-secret', 'value-v1');
      const v1 = await secretsClient.getSecret('versioned-secret');
      
      // Small delay to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 5));
      
      // Update to create v2
      await secretsClient.setSecret('versioned-secret', 'value-v2');
      const v2 = await secretsClient.getSecret('versioned-secret');

      expect(v2.value).toBe('value-v2');
      expect(v2.version).not.toBe(v1.version);

      // Can still get old version
      const oldVersion = await secretsClient.getSecret('versioned-secret', v1.version);
      expect(oldVersion.value).toBe('value-v1');
    });

    it('should handle secret expiration', async () => {
      await secretsClient.setSecret('temp-secret', 'temp-value', {
        expiresOn: new Date(Date.now() + 10), // Expires in 10ms
      });

      await new Promise(resolve => setTimeout(resolve, 20));

      await expect(secretsClient.getSecret('temp-secret')).rejects.toThrow('No valid versions');
    });

    it('should soft delete secrets', async () => {
      await secretsClient.deleteSecret('api-key');

      await expect(secretsClient.getSecret('api-key')).rejects.toThrow(
        'No valid versions'
      );

      // Still in list but disabled
      const secrets = await secretsClient.listSecrets();
      const deletedSecret = secrets.find(s => s.name === 'api-key');
      expect(deletedSecret).toBeDefined();
      expect(deletedSecret?.enabled).toBe(false);
    });

    it('should support secret tags', async () => {
      await secretsClient.setSecret('tagged-secret', 'tagged-value', {
        tags: {
          environment: 'test',
          service: 'api',
        },
      });

      const secret = await secretsClient.getSecret('tagged-secret');
      expect(secret.tags).toEqual({
        environment: 'test',
        service: 'api',
      });
    });

    it('should list secrets without exposing values', async () => {
      const secrets = await secretsClient.listSecrets();
      
      expect(secrets.length).toBeGreaterThan(0);
      for (const secret of secrets) {
        expect(secret).toHaveProperty('name');
        expect(secret).toHaveProperty('enabled');
        expect(secret).not.toHaveProperty('value');
      }
    });
  });
});
