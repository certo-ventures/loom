import { describe, it, expect, beforeEach } from 'vitest';
import {
  WorkflowDefinition,
  InMemoryWorkflowStore,
  WorkflowCompiler,
  InMemoryWorkflowExecutor,
} from '../../workflow';

describe('Workflow Definition Language', () => {
  describe('WorkflowStore', () => {
    let store: InMemoryWorkflowStore;

    beforeEach(() => {
      store = new InMemoryWorkflowStore();
    });

    it('creates new workflow with version 1.0.0', async () => {
      const definition: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: { manual: { type: 'manual' } },
        actions: {
          greet: {
            type: 'Compose',
            inputs: { message: 'Hello World' },
          },
        },
      };

      const version = await store.create('hello-workflow', definition, {
        description: 'Simple greeting workflow',
      });

      expect(version.metadata.id).toBe('hello-workflow');
      expect(version.metadata.version).toBe('1.0.0');
      expect(version.metadata.description).toBe('Simple greeting workflow');
      expect(version.definition).toEqual(definition);
    });

    it('prevents creating duplicate workflows', async () => {
      const definition: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: { manual: { type: 'manual' } },
        actions: { step1: { type: 'Compose', inputs: {} } },
      };

      await store.create('test', definition);
      
      await expect(store.create('test', definition)).rejects.toThrow('already exists');
    });

    it('retrieves latest version when version not specified', async () => {
      const definition: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: { manual: { type: 'manual' } },
        actions: { step1: { type: 'Compose', inputs: { v: 1 } } },
      };

      await store.create('test', definition);
      await store.publish('test', {
        ...definition,
        actions: { step1: { type: 'Compose', inputs: { v: 2 } } },
      }, 'minor');

      const latest = await store.get('test');
      expect(latest?.metadata.version).toBe('1.1.0');
      expect(latest?.definition.actions.step1.inputs).toEqual({ v: 2 });
    });

    it('retrieves specific version', async () => {
      const definition: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: { manual: { type: 'manual' } },
        actions: { step1: { type: 'Compose', inputs: { v: 1 } } },
      };

      await store.create('test', definition);
      await store.publish('test', {
        ...definition,
        actions: { step1: { type: 'Compose', inputs: { v: 2 } } },
      }, 'minor');

      const v1 = await store.get('test', '1.0.0');
      expect(v1?.definition.actions.step1.inputs).toEqual({ v: 1 });

      const v2 = await store.get('test', '1.1.0');
      expect(v2?.definition.actions.step1.inputs).toEqual({ v: 2 });
    });

    it('bumps patch version (1.0.0 -> 1.0.1)', async () => {
      const definition: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: { manual: { type: 'manual' } },
        actions: { step1: { type: 'Compose', inputs: {} } },
      };

      await store.create('test', definition);
      const v2 = await store.publish('test', definition, 'patch');

      expect(v2.metadata.version).toBe('1.0.1');
    });

    it('bumps minor version (1.0.0 -> 1.1.0)', async () => {
      const definition: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: { manual: { type: 'manual' } },
        actions: { step1: { type: 'Compose', inputs: {} } },
      };

      await store.create('test', definition);
      const v2 = await store.publish('test', definition, 'minor');

      expect(v2.metadata.version).toBe('1.1.0');
    });

    it('bumps major version (1.0.0 -> 2.0.0)', async () => {
      const definition: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: { manual: { type: 'manual' } },
        actions: { step1: { type: 'Compose', inputs: {} } },
      };

      await store.create('test', definition);
      const v2 = await store.publish('test', definition, 'major');

      expect(v2.metadata.version).toBe('2.0.0');
    });

    it('lists all versions', async () => {
      const definition: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: { manual: { type: 'manual' } },
        actions: { step1: { type: 'Compose', inputs: {} } },
      };

      await store.create('test', definition);
      await store.publish('test', definition, 'patch');
      await store.publish('test', definition, 'minor');

      const versions = await store.listVersions('test');
      expect(versions).toHaveLength(3);
      expect(versions.map(v => v.version)).toEqual(['1.0.0', '1.0.1', '1.1.0']);
    });

    it('deletes workflow and all versions', async () => {
      const definition: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: { manual: { type: 'manual' } },
        actions: { step1: { type: 'Compose', inputs: {} } },
      };

      await store.create('test', definition);
      await store.delete('test');

      const result = await store.get('test');
      expect(result).toBeNull();
    });
  });

  describe('WorkflowCompiler', () => {
    let compiler: WorkflowCompiler;

    beforeEach(() => {
      compiler = new WorkflowCompiler();
    });

    it('validates workflow with trigger and actions', () => {
      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: { manual: { type: 'manual' } },
        actions: {
          step1: { type: 'Compose', inputs: { msg: 'hello' } },
        },
      };

      const result = compiler.compile(workflow);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects workflow without triggers', () => {
      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: {},
        actions: { step1: { type: 'Compose', inputs: {} } },
      };

      const result = compiler.compile(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('at least one trigger');
    });

    it('rejects workflow without actions', () => {
      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: { manual: { type: 'manual' } },
        actions: {},
      };

      const result = compiler.compile(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('at least one action');
    });

    it('detects unknown runAfter dependency', () => {
      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: { manual: { type: 'manual' } },
        actions: {
          step2: {
            type: 'Compose',
            inputs: {},
            runAfter: { step1: ['Succeeded'] },
          },
        },
      };

      const result = compiler.compile(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors[0].action).toBe('step2');
      expect(result.errors[0].message).toContain('Unknown dependency: step1');
    });

    it('detects circular dependencies', () => {
      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: { manual: { type: 'manual' } },
        actions: {
          step1: {
            type: 'Compose',
            inputs: {},
            runAfter: { step2: ['Succeeded'] },
          },
          step2: {
            type: 'Compose',
            inputs: {},
            runAfter: { step1: ['Succeeded'] },
          },
        },
      };

      const result = compiler.compile(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('Circular dependency');
    });

    it('validates complex dependency graph', () => {
      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: { manual: { type: 'manual' } },
        actions: {
          step1: { type: 'Compose', inputs: {} },
          step2: {
            type: 'Compose',
            inputs: {},
            runAfter: { step1: ['Succeeded'] },
          },
          step3: {
            type: 'Compose',
            inputs: {},
            runAfter: { step1: ['Succeeded'] },
          },
          step4: {
            type: 'Compose',
            inputs: {},
            runAfter: {
              step2: ['Succeeded'],
              step3: ['Succeeded'],
            },
          },
        },
      };

      const result = compiler.compile(workflow);
      expect(result.valid).toBe(true);
    });
  });

  describe('WorkflowExecutor', () => {
    let executor: InMemoryWorkflowExecutor;

    beforeEach(() => {
      executor = new InMemoryWorkflowExecutor();
    });

    it('executes simple workflow', async () => {
      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: { manual: { type: 'manual' } },
        actions: {
          greet: {
            type: 'Compose',
            inputs: { message: 'Hello' },
          },
        },
      };

      const instanceId = await executor.execute(workflow);
      expect(instanceId).toMatch(/^wf-\d+$/);

      // Wait for execution
      await new Promise(resolve => setTimeout(resolve, 50));

      const status = await executor.getStatus(instanceId);
      expect(status).toBe('completed');
    });

    it('executes workflow with dependencies', async () => {
      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: { manual: { type: 'manual' } },
        actions: {
          step1: { type: 'Compose', inputs: { value: 1 } },
          step2: {
            type: 'Compose',
            inputs: { value: 2 },
            runAfter: { step1: ['Succeeded'] },
          },
          step3: {
            type: 'Compose',
            inputs: { value: 3 },
            runAfter: { step2: ['Succeeded'] },
          },
        },
      };

      const instanceId = await executor.execute(workflow);
      
      // Wait for execution
      await new Promise(resolve => setTimeout(resolve, 50));

      const status = await executor.getStatus(instanceId);
      expect(status).toBe('completed');
    });

    it('executes Actor actions', async () => {
      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: { manual: { type: 'manual' } },
        actions: {
          callAgent: {
            type: 'Actor',
            inputs: {
              actorType: 'AIAgent',
              method: 'chat',
              args: { message: 'Hello AI' },
            },
          },
        },
      };

      const instanceId = await executor.execute(workflow);
      
      await new Promise(resolve => setTimeout(resolve, 50));

      const status = await executor.getStatus(instanceId);
      expect(status).toBe('completed');
    });

    it('executes Activity actions', async () => {
      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: { manual: { type: 'manual' } },
        actions: {
          processData: {
            type: 'Activity',
            inputs: {
              activityName: 'data-processor',
              input: { data: [1, 2, 3] },
            },
          },
        },
      };

      const instanceId = await executor.execute(workflow);
      
      await new Promise(resolve => setTimeout(resolve, 50));

      const status = await executor.getStatus(instanceId);
      expect(status).toBe('completed');
    });
  });
});
