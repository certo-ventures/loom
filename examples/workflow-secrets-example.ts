/**
 * Workflow Secrets Management Example
 * 
 * Demonstrates two approaches to using secrets in workflows:
 * 1. Direct @secret() expressions (async, for dynamic access)
 * 2. Pre-loaded parameters (recommended for production)
 */

import { InMemoryWorkflowExecutor, WorkflowDefinition } from '../src/workflow/index.js';
import { createSecretsClient, SecretProperties } from '../src/secrets/index.js';

async function main() {
  console.log('='.repeat(80));
  console.log('Workflow Secrets Management Examples');
  console.log('='.repeat(80));

  // Create secrets client (uses environment variables in dev, Azure Key Vault in production)
  const secretsClient = await createSecretsClient();

  // Add some example secrets
  await secretsClient.setSecret('api-key', 'sk-example-key-123456');
  await secretsClient.setSecret('db-password', 'super-secret-password');
  await secretsClient.setSecret('oauth-token', 'bearer-token-abc');

  console.log('\nSecrets configured:');
  const secrets = await secretsClient.listSecrets();
  secrets.forEach((s: SecretProperties) => console.log(`  - ${s.name} (enabled: ${s.enabled})`));

  // ========================================================================
  // APPROACH 1: Direct @secret() Expressions (Async)
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('Approach 1: Direct @secret() Expressions');
  console.log('='.repeat(80));

  const executor1 = new InMemoryWorkflowExecutor({ secretsClient });

  const workflow1: WorkflowDefinition = {
    $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
    contentVersion: '1.0.0',
    triggers: {
      manual: { type: 'manual' }
    },
    actions: {
      buildConfig: {
        type: 'Compose',
        inputs: {
          database: {
            host: 'db.example.com',
            port: 5432,
            password: "@secret('db-password')",  // Direct secret access
          },
          api: {
            endpoint: 'https://api.example.com',
            key: "@secret('api-key')",  // Direct secret access
          },
          auth: {
            token: "@secret('oauth-token')",  // Direct secret access
          },
        },
      },
    },
  };

  console.log('\nExecuting workflow with @secret() expressions...');
  const instanceId1 = await executor1.execute(workflow1, {});
  const result1 = await executor1.waitForCompletion(instanceId1);

  console.log('\nConfiguration built (secrets retrieved dynamically):');
  console.log(`  Database: ${result1.buildConfig.database.host}`);
  console.log(`  Database Password: ${result1.buildConfig.database.password.substring(0, 10)}...`);
  console.log(`  API Key: ${result1.buildConfig.api.key.substring(0, 15)}...`);
  console.log(`  OAuth Token: ${result1.buildConfig.auth.token.substring(0, 15)}...`);

  // ========================================================================
  // APPROACH 2: Pre-loaded Parameters (Recommended)
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('Approach 2: Pre-loaded Parameters (Production Pattern)');
  console.log('='.repeat(80));

  // Pre-load secrets before workflow execution
  console.log('\nPre-loading secrets...');
  const [apiKey, dbPassword, oauthToken] = await Promise.all([
    secretsClient.getSecret('api-key'),
    secretsClient.getSecret('db-password'),
    secretsClient.getSecret('oauth-token'),
  ]);

  console.log('Secrets loaded (cached for workflow execution)');

  const executor2 = new InMemoryWorkflowExecutor({ secretsClient });

  const workflow2: WorkflowDefinition = {
    $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
    contentVersion: '1.0.0',
    parameters: {
      apiKey: { type: 'string', defaultValue: '' },
      dbPassword: { type: 'string', defaultValue: '' },
      oauthToken: { type: 'string', defaultValue: '' },
    },
    triggers: {
      manual: { type: 'manual' }
    },
    actions: {
      buildConfig: {
        type: 'Compose',
        inputs: {
          database: {
            host: 'db.example.com',
            port: 5432,
            password: "@parameters('dbPassword')",  // From parameter (pre-loaded secret)
          },
          api: {
            endpoint: 'https://api.example.com',
            key: "@parameters('apiKey')",  // From parameter (pre-loaded secret)
          },
          auth: {
            token: "@parameters('oauthToken')",  // From parameter (pre-loaded secret)
          },
        },
      },
    },
  };

  console.log('\nExecuting workflow with pre-loaded secrets...');
  const instanceId2 = await executor2.execute(workflow2, {
    apiKey: apiKey.value,
    dbPassword: dbPassword.value,
    oauthToken: oauthToken.value,
  });
  const result2 = await executor2.waitForCompletion(instanceId2);

  console.log('\nConfiguration built (from pre-loaded parameters):');
  console.log(`  Database: ${result2.buildConfig.database.host}`);
  console.log(`  Database Password: ${result2.buildConfig.database.password.substring(0, 10)}...`);
  console.log(`  API Key: ${result2.buildConfig.api.key.substring(0, 15)}...`);
  console.log(`  OAuth Token: ${result2.buildConfig.auth.token.substring(0, 15)}...`);

  // ========================================================================
  // SECRET VERSIONING
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('Secret Versioning');
  console.log('='.repeat(80));

  console.log('\nRotating API key...');
  const oldKey = await secretsClient.getSecret('api-key');
  console.log(`  Old key version: ${oldKey.version}`);

  // Small delay for different timestamp
  await new Promise(resolve => setTimeout(resolve, 10));

  // Create new version
  await secretsClient.setSecret('api-key', 'sk-new-rotated-key-789');
  const newKey = await secretsClient.getSecret('api-key');
  console.log(`  New key version: ${newKey.version}`);

  // Workflows using @secret() automatically get new version
  const instanceId3 = await executor1.execute(workflow1, {});
  const result3 = await executor1.waitForCompletion(instanceId3);
  console.log(`\nWorkflow now uses rotated key: ${result3.buildConfig.api.key.substring(0, 15)}...`);

  // Can still retrieve old version if needed
  const retrievedOld = await secretsClient.getSecret('api-key', oldKey.version);
  console.log(`Can still access old version: ${retrievedOld.value.substring(0, 15)}...`);

  // ========================================================================
  // SECRET EXPIRATION
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('Secret Expiration');
  console.log('='.repeat(80));

  console.log('\nCreating temporary secret (expires in 100ms)...');
  await secretsClient.setSecret('temp-secret', 'temporary-value', {
    expiresOn: new Date(Date.now() + 100),
    tags: { purpose: 'demo', temporary: 'true' },
  });

  const tempSecret = await secretsClient.getSecret('temp-secret');
  console.log(`  Created: ${tempSecret.name}`);
  console.log(`  Expires: ${tempSecret.expiresOn?.toISOString()}`);
  console.log(`  Tags: ${JSON.stringify(tempSecret.tags)}`);

  console.log('\nWaiting for expiration...');
  await new Promise(resolve => setTimeout(resolve, 150));

  try {
    await secretsClient.getSecret('temp-secret');
    console.log('  ERROR: Should have expired!');
  } catch (error: any) {
    console.log(`  ✓ Secret expired as expected: ${error.message}`);
  }

  // ========================================================================
  // SECRET DELETION (Soft Delete)
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('Secret Deletion (Soft Delete)');
  console.log('='.repeat(80));

  console.log('\nDeleting oauth-token secret...');
  await secretsClient.deleteSecret('oauth-token');

  try {
    await secretsClient.getSecret('oauth-token');
    console.log('  ERROR: Deleted secret should not be accessible!');
  } catch (error: any) {
    console.log(`  ✓ Cannot access deleted secret: ${error.message}`);
  }

  // But it's still in the list (soft delete)
  const allSecrets = await secretsClient.listSecrets();
  const deletedSecret = allSecrets.find((s: SecretProperties) => s.name === 'oauth-token');
  console.log(`\nDeleted secret still in list: ${deletedSecret?.name} (enabled: ${deletedSecret?.enabled})`);

  // ========================================================================
  // PRODUCTION SETUP
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('Production Setup Guide');
  console.log('='.repeat(80));

  console.log(`
For production with Azure Key Vault:

1. Install Azure SDK (optional dependency):
   npm install @azure/keyvault-secrets @azure/identity

2. Set environment variables:
   AZURE_KEY_VAULT_NAME=your-vault-name
   
3. Secrets client will automatically use Azure Key Vault:
   const secretsClient = createSecretsClient(); // Auto-detects Azure

4. For development, use in-memory client (current mode):
   - Loads from environment variables (AZURE_OPENAI_API_KEY, etc.)
   - No Azure SDK required
   - Perfect for local development

Benefits of Secrets Management:
✓ No hardcoded credentials in code
✓ Automatic secret rotation
✓ Audit trail of secret access
✓ Centralized secret management
✓ Environment-specific secrets
✓ Compliance and security
  `);

  console.log('\n' + '='.repeat(80));
  console.log('Examples Complete!');
  console.log('='.repeat(80));
}

main().catch(console.error);
