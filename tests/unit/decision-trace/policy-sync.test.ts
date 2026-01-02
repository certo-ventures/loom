/**
 * Tests for PolicySync - Distributed policy management
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PolicySync, ConflictResolver, VersionControl } from '../../../src/memory/graph/policy-sync';
import { PolicyMemory } from '../../../src/memory/graph/policy-memory';
import { DecisionMemory } from '../../../src/memory/graph/decision-memory';
import { InMemoryGraphStorage } from '../../../src/memory/graph/in-memory-storage';
import { LamportClock } from '../../../src/timing/lamport-clock';
import type { Policy } from '../../../src/memory/graph/policy-memory';
import type { SyncConfig } from '../../../src/memory/graph/policy-sync';

describe('PolicySync - Distributed Policy Management', () => {
  let storage: InMemoryGraphStorage;
  let clock: LamportClock;
  let decisionMemory: DecisionMemory;
  let policyMemory: PolicyMemory;
  let policySync: PolicySync;

  // Helper to add remote tenant policies
  const addRemotePolicies = async (tenantId: string, policies: Policy[]) => {
    await storage.addFact({
      id: `${tenantId}:policies:${Date.now()}`,
      actorId: 'test-actor',
      graph_id: tenantId,
      type: 'tenant-policies',
      content: JSON.stringify(policies),
      validFrom: new Date(),
      confidence: 1.0,
      source: 'test'
    });
  };

  beforeEach(async () => {
    storage = new InMemoryGraphStorage();
    clock = new LamportClock();
    decisionMemory = new DecisionMemory('test-actor', storage, clock);
    policyMemory = new PolicyMemory('test-actor', storage, clock, { decisionMemory });
    policySync = new PolicySync('test-actor', storage, clock, {
      policyMemory,
      localTenantId: 'tenant-local',
      conflictStrategy: 'auto-merge'
    });
  });

  describe('Pull Synchronization', () => {
    it('should pull new policies from remote tenant', async () => {
      // Create remote policies
      const remotePolicies: Policy[] = [
        {
          id: 'policy-remote-1',
          version: '1.0',
          name: 'Remote Policy 1',
          rules: [{ condition: 'amount > 1000', action: 'require_approval' }],
          createdAt: Date.now(),
          isActive: true
        },
        {
          id: 'policy-remote-2',
          version: '1.0',
          name: 'Remote Policy 2',
          rules: [{ condition: 'risk > 0.8', action: 'reject' }],
          createdAt: Date.now(),
          isActive: true
        }
      ];

      // Simulate remote tenant storage using fact storage
      await addRemotePolicies('tenant-remote', remotePolicies);

      // Pull from remote
      const config: SyncConfig = {
        remoteTenantId: 'tenant-remote',
        syncMode: 'pull',
        conflictStrategy: 'auto-merge',
        autoResolve: true
      };

      const result = await policySync.syncWithTenant(config);

      expect(result.success).toBe(true);
      expect(result.pulledPolicies.length).toBe(2);
      expect(result.pulledPolicies).toContain('policy-remote-1:1.0');
      expect(result.pulledPolicies).toContain('policy-remote-2:1.0');
      expect(result.conflicts.length).toBe(0);

      // Verify policies were added locally
      const localPolicy1 = await policyMemory.getPolicy('policy-remote-1', '1.0');
      expect(localPolicy1).toBeDefined();
      expect(localPolicy1?.name).toBe('Remote Policy 1');
    });

    it('should not pull existing policies', async () => {
      // Add local policy
      const localPolicy: Policy = {
        id: 'policy-1',
        version: '1.0',
        name: 'Local Policy',
        rules: [],
        createdAt: Date.now(),
        isActive: true
      };
      await policyMemory.addPolicy(localPolicy);

      // Remote has same policy
      await addRemotePolicies('tenant-remote', [localPolicy]);

      const config: SyncConfig = {
        remoteTenantId: 'tenant-remote',
        syncMode: 'pull',
        conflictStrategy: 'auto-merge',
        autoResolve: true
      };

      const result = await policySync.syncWithTenant(config);

      expect(result.success).toBe(true);
      expect(result.pulledPolicies.length).toBe(0);  // Already exists
    });
  });

  describe('Push Synchronization', () => {
    it('should push local policies to remote tenant', async () => {
      // Add local policies
      const localPolicy: Policy = {
        id: 'policy-local-1',
        version: '1.0',
        name: 'Local Policy',
        rules: [{ condition: 'status == "approved"', action: 'proceed' }],
        createdAt: Date.now(),
        isActive: true
      };
      await policyMemory.addPolicy(localPolicy);

      const config: SyncConfig = {
        remoteTenantId: 'tenant-remote',
        syncMode: 'push',
        conflictStrategy: 'auto-merge',
        autoResolve: true
      };

      const result = await policySync.syncWithTenant(config);

      expect(result.success).toBe(true);
      expect(result.pushedPolicies.length).toBe(1);
      expect(result.pushedPolicies).toContain('policy-local-1:1.0');

      // Verify pushed to remote by querying facts
      const facts = await storage.searchFacts({
        actorId: 'test-actor',
        graph_id: 'tenant-remote',
        limit: 10
      });
      expect(facts.length).toBeGreaterThan(0);
      const remotePolicies = JSON.parse(facts[0].content);
      expect(remotePolicies.length).toBeGreaterThanOrEqual(1);
      expect(remotePolicies[0].id).toBe('policy-local-1');
    });
  });

  describe('Bidirectional Synchronization', () => {
    it('should sync policies in both directions', async () => {
      // Add local policy
      const localPolicy: Policy = {
        id: 'policy-local',
        version: '1.0',
        name: 'Local Policy',
        rules: [],
        createdAt: Date.now(),
        isActive: true
      };
      await policyMemory.addPolicy(localPolicy);

      // Add remote policy
      const remotePolicy: Policy = {
        id: 'policy-remote',
        version: '1.0',
        name: 'Remote Policy',
        rules: [],
        createdAt: Date.now(),
        isActive: true
      };
      await addRemotePolicies('tenant-remote', [remotePolicy]);

      const config: SyncConfig = {
        remoteTenantId: 'tenant-remote',
        syncMode: 'bidirectional',
        conflictStrategy: 'auto-merge',
        autoResolve: true
      };

      const result = await policySync.syncWithTenant(config);

      expect(result.success).toBe(true);
      expect(result.pushedPolicies.length).toBeGreaterThan(0);
      expect(result.pulledPolicies.length).toBe(1);
      expect(result.pulledPolicies).toContain('policy-remote:1.0');
    });
  });

  describe('Conflict Detection', () => {
    it('should detect version conflicts', async () => {
      // Add local policy v1.0
      const localPolicy: Policy = {
        id: 'policy-1',
        version: '1.0',
        name: 'Policy',
        rules: [{ condition: 'x > 10', action: 'approve' }],
        createdAt: Date.now(),
        isActive: true
      };
      await policyMemory.addPolicy(localPolicy);

      // Remote has v2.0
      const remotePolicy: Policy = {
        id: 'policy-1',
        version: '2.0',
        name: 'Policy',
        rules: [{ condition: 'x > 10', action: 'approve' }],
        createdAt: Date.now(),
        isActive: true
      };
      await addRemotePolicies('tenant-remote', [remotePolicy]);

      const config: SyncConfig = {
        remoteTenantId: 'tenant-remote',
        syncMode: 'bidirectional',
        conflictStrategy: 'auto-merge',
        autoResolve: false  // Don't auto-resolve
      };

      const result = await policySync.syncWithTenant(config);

      expect(result.conflicts.length).toBe(1);
      expect(result.conflicts[0].policyId).toBe('policy-1');
      expect(result.conflicts[0].conflictType).toBe('version');
      expect(result.conflicts[0].localVersion).toBe('1.0');
      expect(result.conflicts[0].remoteVersion).toBe('2.0');
    });

    it('should detect content conflicts in same version', async () => {
      // Add local policy
      const localPolicy: Policy = {
        id: 'policy-1',
        version: '1.0',
        name: 'Policy',
        rules: [{ condition: 'x > 10', action: 'approve' }],
        createdAt: Date.now(),
        isActive: true
      };
      await policyMemory.addPolicy(localPolicy);

      // Remote has same version but different rules
      const remotePolicy: Policy = {
        id: 'policy-1',
        version: '1.0',
        name: 'Policy',
        rules: [{ condition: 'x > 20', action: 'approve' }],  // Different threshold
        createdAt: Date.now(),
        isActive: true
      };
      await addRemotePolicies('tenant-remote', [remotePolicy]);

      const config: SyncConfig = {
        remoteTenantId: 'tenant-remote',
        syncMode: 'bidirectional',
        conflictStrategy: 'auto-merge',
        autoResolve: false
      };

      const result = await policySync.syncWithTenant(config);

      expect(result.conflicts.length).toBe(1);
      expect(result.conflicts[0].conflictType).toBe('content');
    });
  });

  describe('Conflict Resolution', () => {
    it('should resolve with local-wins strategy', async () => {
      const localPolicy: Policy = {
        id: 'policy-1',
        version: '1.0',
        name: 'Local',
        rules: [{ condition: 'local', action: 'approve' }],
        createdAt: Date.now(),
        isActive: true
      };
      await policyMemory.addPolicy(localPolicy);

      const remotePolicy: Policy = {
        id: 'policy-1',
        version: '1.0',
        name: 'Remote',
        rules: [{ condition: 'remote', action: 'approve' }],
        createdAt: Date.now(),
        isActive: true
      };
      await addRemotePolicies('tenant-remote', [remotePolicy]);

      const config: SyncConfig = {
        remoteTenantId: 'tenant-remote',
        syncMode: 'bidirectional',
        conflictStrategy: 'local-wins',
        autoResolve: true
      };

      const result = await policySync.syncWithTenant(config);

      expect(result.conflicts.length).toBe(1);
      expect(result.resolvedConflicts.length).toBe(1);
      expect(result.conflicts[0].resolution?.strategy).toBe('local');
    });

    it('should resolve with remote-wins strategy', async () => {
      const localPolicy: Policy = {
        id: 'policy-1',
        version: '1.0',
        name: 'Local',
        rules: [{ condition: 'local', action: 'approve' }],
        createdAt: Date.now(),
        isActive: true
      };
      await policyMemory.addPolicy(localPolicy);

      const remotePolicy: Policy = {
        id: 'policy-1',
        version: '1.0',
        name: 'Remote',
        rules: [{ condition: 'remote', action: 'approve' }],
        createdAt: Date.now(),
        isActive: true
      };
      await addRemotePolicies('tenant-remote', [remotePolicy]);

      const config: SyncConfig = {
        remoteTenantId: 'tenant-remote',
        syncMode: 'bidirectional',
        conflictStrategy: 'remote-wins',
        autoResolve: true
      };

      const result = await policySync.syncWithTenant(config);

      expect(result.conflicts.length).toBe(1);
      expect(result.resolvedConflicts.length).toBe(1);
      expect(result.conflicts[0].resolution?.strategy).toBe('remote');
      
      // Verify remote policy was applied
      const resolved = result.conflicts[0].resolution?.mergedPolicy;
      expect(resolved?.name).toBe('Remote');
    });

    it('should auto-merge non-conflicting changes', async () => {
      const localPolicy: Policy = {
        id: 'policy-1',
        version: '1.0',
        name: 'Policy',
        rules: [
          { condition: 'x > 10', action: 'approve' },
          { condition: 'y > 20', action: 'approve' }  // Local added this
        ],
        createdAt: Date.now(),
        isActive: true
      };
      await policyMemory.addPolicy(localPolicy);

      const remotePolicy: Policy = {
        id: 'policy-1',
        version: '1.0',
        name: 'Policy',
        rules: [
          { condition: 'x > 10', action: 'approve' },
          { condition: 'z > 30', action: 'approve' }  // Remote added this
        ],
        createdAt: Date.now(),
        isActive: true
      };
      await addRemotePolicies('tenant-remote', [remotePolicy]);

      const config: SyncConfig = {
        remoteTenantId: 'tenant-remote',
        syncMode: 'bidirectional',
        conflictStrategy: 'auto-merge',
        autoResolve: true
      };

      const result = await policySync.syncWithTenant(config);

      expect(result.conflicts.length).toBe(1);
      expect(result.resolvedConflicts.length).toBe(1);
      
      const merged = result.conflicts[0].resolution?.mergedPolicy;
      expect(merged?.rules.length).toBe(3);  // Should have all 3 rules
    });
  });

  describe('Federation', () => {
    it('should track federated tenant metadata', async () => {
      const config: SyncConfig = {
        remoteTenantId: 'tenant-remote',
        syncMode: 'pull',
        conflictStrategy: 'auto-merge',
        autoResolve: true
      };

      await policySync.syncWithTenant(config);

      const metadata = await policySync.getFederationMetadata('tenant-remote');
      expect(metadata).toBeDefined();
      expect(metadata?.tenantId).toBe('tenant-remote');
      expect(metadata?.syncCount).toBe(1);
      expect(metadata?.lastSyncAt).toBeGreaterThan(0);
    });

    it('should increment sync count on multiple syncs', async () => {
      const config: SyncConfig = {
        remoteTenantId: 'tenant-remote',
        syncMode: 'pull',
        conflictStrategy: 'auto-merge',
        autoResolve: true
      };

      await policySync.syncWithTenant(config);
      await policySync.syncWithTenant(config);
      await policySync.syncWithTenant(config);

      const metadata = await policySync.getFederationMetadata('tenant-remote');
      expect(metadata?.syncCount).toBe(3);
    });

    it('should list all federated tenants', async () => {
      await policySync.syncWithTenant({
        remoteTenantId: 'tenant-1',
        syncMode: 'pull',
        conflictStrategy: 'auto-merge',
        autoResolve: true
      });

      await policySync.syncWithTenant({
        remoteTenantId: 'tenant-2',
        syncMode: 'pull',
        conflictStrategy: 'auto-merge',
        autoResolve: true
      });

      const tenants = await policySync.listFederatedTenants();
      expect(tenants.length).toBe(2);
      expect(tenants.map(t => t.tenantId)).toContain('tenant-1');
      expect(tenants.map(t => t.tenantId)).toContain('tenant-2');
    });
  });

  describe('Version Control', () => {
    it('should create branches', async () => {
      await policySync.createBranch('feature-1');
      
      // Should not throw - branch created successfully
      expect(true).toBe(true);
    });

    it('should merge branches', async () => {
      // Add policy to main
      const mainPolicy: Policy = {
        id: 'policy-1',
        version: '1.0',
        name: 'Main Policy',
        rules: [],
        createdAt: Date.now(),
        isActive: true
      };
      await policyMemory.addPolicy(mainPolicy);

      // Create branch
      await policySync.createBranch('feature-1');

      // Merge branch back to main
      const result = await policySync.mergeBranch('feature-1', 'auto-merge');
      
      expect(result.success).toBe(true);
    });

    it('should tag versions', async () => {
      await policySync.tagVersion('policy-1', '1.0', 'stable');
      
      // Should not throw
      expect(true).toBe(true);
    });

    it('should retrieve version history', async () => {
      const history = await policySync.getVersionHistory('policy-1');
      
      expect(Array.isArray(history)).toBe(true);
    });
  });

  describe('ConflictResolver', () => {
    it('should resolve with local-wins', async () => {
      const resolver = new ConflictResolver('local-wins');
      
      const conflict = {
        policyId: 'policy-1',
        localVersion: '1.0',
        remoteVersion: '1.0',
        conflictType: 'content' as const,
        localPolicy: {
          id: 'policy-1',
          version: '1.0',
          name: 'Local',
          rules: [],
          createdAt: Date.now(),
          isActive: true
        },
        remotePolicy: {
          id: 'policy-1',
          version: '1.0',
          name: 'Remote',
          rules: [],
          createdAt: Date.now(),
          isActive: true
        },
        autoResolvable: true
      };

      const resolution = await resolver.resolve(conflict);
      
      expect(resolution).toBeDefined();
      expect(resolution?.strategy).toBe('local');
      expect(resolution?.mergedPolicy.name).toBe('Local');
    });

    it('should resolve with remote-wins', async () => {
      const resolver = new ConflictResolver('remote-wins');
      
      const conflict = {
        policyId: 'policy-1',
        localVersion: '1.0',
        remoteVersion: '1.0',
        conflictType: 'content' as const,
        localPolicy: {
          id: 'policy-1',
          version: '1.0',
          name: 'Local',
          rules: [],
          createdAt: Date.now(),
          isActive: true
        },
        remotePolicy: {
          id: 'policy-1',
          version: '1.0',
          name: 'Remote',
          rules: [],
          createdAt: Date.now(),
          isActive: true
        },
        autoResolvable: true
      };

      const resolution = await resolver.resolve(conflict);
      
      expect(resolution).toBeDefined();
      expect(resolution?.strategy).toBe('remote');
      expect(resolution?.mergedPolicy.name).toBe('Remote');
    });

    it('should auto-merge compatible changes', async () => {
      const resolver = new ConflictResolver('auto-merge');
      
      const conflict = {
        policyId: 'policy-1',
        localVersion: '1.0',
        remoteVersion: '1.0',
        conflictType: 'content' as const,
        localPolicy: {
          id: 'policy-1',
          version: '1.0',
          name: 'Policy',
          rules: [
            { condition: 'x > 10', action: 'approve' },
            { condition: 'y > 20', action: 'approve' }
          ],
          createdAt: Date.now(),
          isActive: true
        },
        remotePolicy: {
          id: 'policy-1',
          version: '1.0',
          name: 'Policy',
          rules: [
            { condition: 'x > 10', action: 'approve' },
            { condition: 'z > 30', action: 'reject' }
          ],
          createdAt: Date.now(),
          isActive: true
        },
        autoResolvable: true
      };

      const resolution = await resolver.resolve(conflict);
      
      expect(resolution).toBeDefined();
      expect(resolution?.strategy).toBe('merge');
      expect(resolution?.mergedPolicy.rules.length).toBe(3);
    });
  });
});
