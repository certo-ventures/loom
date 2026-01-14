/**
 * PolicySync - Multi-tenant policy synchronization with conflict resolution
 * 
 * Enables distributed policy management across multiple tenants with:
 * - Pull/Push synchronization
 * - Conflict detection and resolution
 * - Version control (Git-like)
 * - Federation protocol
 */

import { ActorMemory } from './actor-memory';
import type { MemoryStorage } from './types';
import type { LamportClock } from '../../timing/lamport-clock';
import type { PolicyMemory, Policy } from './policy-memory';

/**
 * Sync operation result
 */
export interface SyncResult {
  success: boolean;
  pushedPolicies: string[];
  pulledPolicies: string[];
  conflicts: PolicyConflict[];
  resolvedConflicts: string[];
  errors: string[];
}

/**
 * Policy conflict during sync
 */
export interface PolicyConflict {
  policyId: string;
  localVersion: string;
  remoteVersion: string;
  conflictType: 'version' | 'content' | 'deletion';
  localPolicy: Policy;
  remotePolicy: Policy | null;
  basePolicy?: Policy;  // Common ancestor for 3-way merge
  autoResolvable: boolean;
  resolution?: ConflictResolution;
}

/**
 * Conflict resolution strategy
 */
export interface ConflictResolution {
  strategy: 'local' | 'remote' | 'merge' | 'manual';
  mergedPolicy?: Policy;
  reasoning: string;
}

/**
 * Policy version metadata
 */
export interface PolicyVersion {
  policyId: string;
  version: string;
  parentVersion?: string;
  branches: string[];
  tags: string[];
  createdAt: number;
  author: string;
  commitMessage: string;
  checksum: string;
}

/**
 * Sync configuration
 */
export interface SyncConfig {
  remoteTenantId: string;
  syncMode: 'pull' | 'push' | 'bidirectional';
  conflictStrategy: 'local-wins' | 'remote-wins' | 'auto-merge' | 'manual';
  autoResolve: boolean;
  branchName?: string;
}

/**
 * Federation metadata
 */
export interface FederationMetadata {
  tenantId: string;
  tenantName: string;
  endpoint: string;
  publicPolicies: string[];
  trustLevel: number;  // 0-1
  lastSyncAt: number;
  syncCount: number;
}

/**
 * PolicySync - Distributed policy synchronization
 */
export class PolicySync extends ActorMemory {
  private policyMemory?: PolicyMemory;
  private localTenantId: string;
  private federatedTenants: Map<string, FederationMetadata> = new Map();
  private conflictResolver: ConflictResolver;
  private versionControl: VersionControl;

  constructor(
    actorId: string,
    storage: MemoryStorage,
    clock: LamportClock,
    options: {
      policyMemory?: PolicyMemory;
      localTenantId: string;
      conflictStrategy?: 'local-wins' | 'remote-wins' | 'auto-merge' | 'manual';
    }
  ) {
    super(actorId, storage, clock);
    this.policyMemory = options.policyMemory;
    this.localTenantId = options.localTenantId;
    this.conflictResolver = new ConflictResolver(options.conflictStrategy || 'auto-merge');
    this.versionControl = new VersionControl(storage, clock);
  }

  /**
   * Sync policies with remote tenant
   */
  async syncWithTenant(config: SyncConfig): Promise<SyncResult> {
    const result: SyncResult = {
      success: true,
      pushedPolicies: [],
      pulledPolicies: [],
      conflicts: [],
      resolvedConflicts: [],
      errors: []
    };

    try {
      // Get local and remote policies
      const localPolicies = await this.getLocalPolicies();
      const remotePolicies = await this.getRemotePolicies(config.remoteTenantId);

      // Detect conflicts
      const conflicts = await this.detectConflicts(localPolicies, remotePolicies);
      result.conflicts = conflicts;

      // Resolve conflicts if auto-resolve enabled
      if (config.autoResolve && conflicts.length > 0) {
        const resolutions = await this.resolveConflicts(conflicts, config.conflictStrategy);
        result.resolvedConflicts = resolutions.map(r => r.policyId);
        
        // Apply resolutions
        for (const resolution of resolutions) {
          if (resolution.resolution?.mergedPolicy) {
            await this.applyResolution(resolution);
          }
        }
      }

      // Push local changes if needed
      if (config.syncMode === 'push' || config.syncMode === 'bidirectional') {
        const pushed = await this.pushPolicies(localPolicies, config.remoteTenantId);
        result.pushedPolicies = pushed;
      }

      // Pull remote changes if needed
      if (config.syncMode === 'pull' || config.syncMode === 'bidirectional') {
        const pulled = await this.pullPolicies(remotePolicies, config);
        result.pulledPolicies = pulled;
      }

      // Update federation metadata
      await this.updateFederationMetadata(config.remoteTenantId);

    } catch (error) {
      result.success = false;
      result.errors.push(error instanceof Error ? error.message : String(error));
    }

    return result;
  }

  /**
   * Get local policies
   */
  private async getLocalPolicies(): Promise<Policy[]> {
    if (!this.policyMemory) {
      return [];
    }

    const policies = await this.policyMemory.getAllPolicies();
    return policies;
  }

  /**
   * Get remote policies (stub - would call remote API)
   */
  private async getRemotePolicies(remoteTenantId: string): Promise<Policy[]> {
    // In real implementation, this would call remote tenant's API
    // For now, simulate by reading from a fact in storage
    const facts = await this.storage.searchFacts({
      actorId: this.actorId,
      graph_id: remoteTenantId,
      limit: 1
    });
    
    if (facts.length === 0) {
      return [];
    }

    try {
      const text = facts[0].text || (facts[0] as any).content;
      return JSON.parse(text);
    } catch {
      return [];
    }
  }

  /**
   * Detect conflicts between local and remote policies
   */
  private async detectConflicts(
    localPolicies: Policy[],
    remotePolicies: Policy[]
  ): Promise<PolicyConflict[]> {
    const conflicts: PolicyConflict[] = [];
    const localMap = new Map(localPolicies.map(p => [`${p.id}:${p.version}`, p]));
    const remoteMap = new Map(remotePolicies.map(p => [`${p.id}:${p.version}`, p]));

    // Check for version conflicts
    for (const localPolicy of localPolicies) {
      const key = `${localPolicy.id}:${localPolicy.version}`;
      const remotePolicy = remoteMap.get(key);

      if (remotePolicy) {
        // Same version exists in both - check for content differences
        if (this.hasContentDifference(localPolicy, remotePolicy)) {
          conflicts.push({
            policyId: localPolicy.id,
            localVersion: localPolicy.version,
            remoteVersion: remotePolicy.version,
            conflictType: 'content',
            localPolicy,
            remotePolicy,
            autoResolvable: await this.isAutoResolvable(localPolicy, remotePolicy)
          });
        }
      }
    }

    // Check for policies in remote but not local (potential pulls)
    for (const remotePolicy of remotePolicies) {
      const localPolicy = localPolicies.find(p => p.id === remotePolicy.id);
      
      if (localPolicy && localPolicy.version !== remotePolicy.version) {
        // Version mismatch
        conflicts.push({
          policyId: remotePolicy.id,
          localVersion: localPolicy.version,
          remoteVersion: remotePolicy.version,
          conflictType: 'version',
          localPolicy,
          remotePolicy,
          autoResolvable: await this.isAutoResolvable(localPolicy, remotePolicy)
        });
      }
    }

    return conflicts;
  }

  /**
   * Check if policies have content differences
   */
  private hasContentDifference(policy1: Policy, policy2: Policy): boolean {
    // Compare rule counts
    if ((policy1.rules?.length || 0) !== (policy2.rules?.length || 0)) {
      return true;
    }

    // Compare rule content
    const rules1Str = JSON.stringify(policy1.rules?.sort() || []);
    const rules2Str = JSON.stringify(policy2.rules?.sort() || []);
    
    return rules1Str !== rules2Str;
  }

  /**
   * Check if conflict can be auto-resolved
   */
  private async isAutoResolvable(local: Policy, remote: Policy): Promise<boolean> {
    // Auto-resolvable if:
    // 1. Only metadata changed (name, description)
    // 2. Rules only added (not modified or removed)
    // 3. No overlapping changes

    // Check if rules were only added
    const localRuleIds = new Set(local.rules?.map((r: any) => JSON.stringify(r)) || []);
    const remoteRuleIds = new Set(remote.rules?.map((r: any) => JSON.stringify(r)) || []);

    const commonRules = [...localRuleIds].filter(r => remoteRuleIds.has(r));
    const localOnly = [...localRuleIds].filter(r => !remoteRuleIds.has(r));
    const remoteOnly = [...remoteRuleIds].filter(r => !localRuleIds.has(r));

    // If both have common rules and only added different rules, it's auto-resolvable
    if (commonRules.length > 0 && localOnly.length > 0 && remoteOnly.length > 0) {
      // Check that the only changes are additions (no deletions)
      // This is auto-mergeable: just combine local-only and remote-only rules
      return true;
    }

    // If only one side changed, auto-resolvable
    if (localOnly.length > 0 && remoteOnly.length === 0) {
      return true;
    }
    if (remoteOnly.length > 0 && localOnly.length === 0) {
      return true;
    }

    return false;
  }

  /**
   * Parse semantic version to number for comparison
   */
  private parseVersion(version: string): number {
    const parts = version.split('.').map(p => parseInt(p, 10));
    return parts[0] * 10000 + (parts[1] || 0) * 100 + (parts[2] || 0);
  }

  /**
   * Resolve conflicts
   */
  private async resolveConflicts(
    conflicts: PolicyConflict[],
    strategy: 'local-wins' | 'remote-wins' | 'auto-merge' | 'manual'
  ): Promise<PolicyConflict[]> {
    const resolutions: PolicyConflict[] = [];

    for (const conflict of conflicts) {
      // local-wins and remote-wins always work
      // auto-merge only works if autoResolvable
      // manual requires human intervention (but we'll attempt anyway)
      if (strategy === 'auto-merge' && !conflict.autoResolvable) {
        continue;  // Skip non-auto-mergeable conflicts
      }

      const resolution = await this.conflictResolver.resolve(conflict, strategy);
      if (resolution) {
        conflict.resolution = resolution;
        resolutions.push(conflict);
      }
    }

    return resolutions;
  }

  /**
   * Apply conflict resolution
   */
  private async applyResolution(conflict: PolicyConflict): Promise<void> {
    if (!this.policyMemory || !conflict.resolution?.mergedPolicy) {
      return;
    }

    await this.policyMemory.addPolicy(conflict.resolution.mergedPolicy);
  }

  /**
   * Push local policies to remote tenant
   */
  private async pushPolicies(policies: Policy[], remoteTenantId: string): Promise<string[]> {
    // In real implementation, this would call remote tenant's API
    // For now, simulate by creating a fact in storage
    (this.storage as any).addFact({
      id: `${remoteTenantId}:policies:${Date.now()}`,
      actorId: this.actorId,
      graph_id: remoteTenantId,
      type: 'tenant-policies',
      content: JSON.stringify(policies),
      validFrom: new Date(),
      confidence: 1.0,
      source: 'policy-sync' as any
    });

    return policies.map(p => `${p.id}:${p.version}`);
  }

  /**
   * Pull remote policies to local
   */
  private async pullPolicies(
    remotePolicies: Policy[],
    config: SyncConfig
  ): Promise<string[]> {
    if (!this.policyMemory) {
      return [];
    }

    const pulled: string[] = [];

    for (const remotePolicy of remotePolicies) {
      const localPolicy = await this.policyMemory.getPolicy(remotePolicy.id, remotePolicy.version);
      
      if (!localPolicy) {
        // New policy - add it
        await this.policyMemory.addPolicy(remotePolicy);
        pulled.push(`${remotePolicy.id}:${remotePolicy.version}`);
      }
    }

    return pulled;
  }

  /**
   * Update federation metadata
   */
  private async updateFederationMetadata(remoteTenantId: string): Promise<void> {
    let metadata = this.federatedTenants.get(remoteTenantId);
    
    if (!metadata) {
      metadata = {
        tenantId: remoteTenantId,
        tenantName: remoteTenantId,
        endpoint: `tenant://${remoteTenantId}`,
        publicPolicies: [],
        trustLevel: 0.5,
        lastSyncAt: Date.now(),
        syncCount: 1
      };
    } else {
      metadata.lastSyncAt = Date.now();
      metadata.syncCount++;
    }

    this.federatedTenants.set(remoteTenantId, metadata);

    // Persist to storage
    (this.storage as any).addFact({
      id: `federation:${this.localTenantId}:${remoteTenantId}`,
      actorId: this.actorId,
      graph_id: this.localTenantId,
      type: 'federation-metadata',
      content: JSON.stringify(metadata),
      validFrom: new Date(),
      confidence: 1.0,
      source: 'policy-sync' as any
    });
  }

  /**
   * Get federation metadata for tenant
   */
  async getFederationMetadata(remoteTenantId: string): Promise<FederationMetadata | null> {
    return this.federatedTenants.get(remoteTenantId) || null;
  }

  /**
   * List all federated tenants
   */
  async listFederatedTenants(): Promise<FederationMetadata[]> {
    return [...this.federatedTenants.values()];
  }

  /**
   * Create a new branch for policy development
   */
  async createBranch(branchName: string, fromVersion?: string): Promise<void> {
    await this.versionControl.createBranch(this.actorId, branchName, fromVersion);
  }

  /**
   * Merge branch into main
   */
  async mergeBranch(branchName: string, strategy: 'local-wins' | 'remote-wins' | 'auto-merge'): Promise<SyncResult> {
    const mainPolicies = await this.versionControl.getBranchPolicies(this.actorId, 'main');
    const branchPolicies = await this.versionControl.getBranchPolicies(this.actorId, branchName);

    const conflicts = await this.detectConflicts(mainPolicies, branchPolicies);
    const resolutions = await this.resolveConflicts(conflicts, strategy);

    const result: SyncResult = {
      success: true,
      pushedPolicies: [],
      pulledPolicies: branchPolicies.map(p => `${p.id}:${p.version}`),
      conflicts,
      resolvedConflicts: resolutions.map(r => r.policyId),
      errors: []
    };

    // Apply resolutions
    for (const resolution of resolutions) {
      if (resolution.resolution?.mergedPolicy) {
        await this.applyResolution(resolution);
      }
    }

    return result;
  }

  /**
   * Tag a policy version
   */
  async tagVersion(policyId: string, version: string, tag: string): Promise<void> {
    await this.versionControl.tagVersion(policyId, version, tag);
  }

  /**
   * Get policy version history
   */
  async getVersionHistory(policyId: string): Promise<PolicyVersion[]> {
    return this.versionControl.getVersionHistory(policyId);
  }
}

/**
 * ConflictResolver - Intelligent conflict resolution
 */
export class ConflictResolver {
  constructor(
    private defaultStrategy: 'local-wins' | 'remote-wins' | 'auto-merge' | 'manual'
  ) {}

  /**
   * Resolve a conflict
   */
  async resolve(
    conflict: PolicyConflict,
    strategy?: 'local-wins' | 'remote-wins' | 'auto-merge' | 'manual'
  ): Promise<ConflictResolution | null> {
    const resolveStrategy = strategy || this.defaultStrategy;

    switch (resolveStrategy) {
      case 'local-wins':
        return this.resolveLocalWins(conflict);
      
      case 'remote-wins':
        return this.resolveRemoteWins(conflict);
      
      case 'auto-merge':
        return this.resolveAutoMerge(conflict);
      
      case 'manual':
        return null;  // Requires manual intervention
      
      default:
        return null;
    }
  }

  /**
   * Resolve using local policy
   */
  private resolveLocalWins(conflict: PolicyConflict): ConflictResolution {
    return {
      strategy: 'local',
      mergedPolicy: conflict.localPolicy,
      reasoning: 'Local policy takes precedence per conflict strategy'
    };
  }

  /**
   * Resolve using remote policy
   */
  private resolveRemoteWins(conflict: PolicyConflict): ConflictResolution | null {
    if (!conflict.remotePolicy) {
      return null;
    }

    return {
      strategy: 'remote',
      mergedPolicy: conflict.remotePolicy,
      reasoning: 'Remote policy takes precedence per conflict strategy'
    };
  }

  /**
   * Auto-merge policies (3-way merge)
   */
  private resolveAutoMerge(conflict: PolicyConflict): ConflictResolution | null {
    if (!conflict.remotePolicy) {
      return null;
    }

    // Perform 3-way merge
    const merged = this.threeWayMerge(
      conflict.localPolicy,
      conflict.remotePolicy,
      conflict.basePolicy
    );

    if (!merged) {
      return null;
    }

    return {
      strategy: 'merge',
      mergedPolicy: merged,
      reasoning: 'Automatically merged changes from both local and remote'
    };
  }

  /**
   * Three-way merge algorithm
   */
  private threeWayMerge(
    local: Policy,
    remote: Policy,
    base?: Policy
  ): Policy | null {
    // If no base, can't do 3-way merge
    if (!base) {
      // Try simple merge - combine rules from both
      return this.simpleMerge(local, remote);
    }

    // Identify changes from base
    const localChanges = this.getChanges(base, local);
    const remoteChanges = this.getChanges(base, remote);

    // Check for conflicting changes
    if (this.hasConflictingChanges(localChanges, remoteChanges)) {
      return null;  // Can't auto-merge
    }

    // Apply both sets of changes to base
    const merged: Policy = {
      ...base,
      version: this.incrementVersion(Math.max(
        this.parseVersion(local.version),
        this.parseVersion(remote.version)
      )),
      rules: [...(base.rules || [])],
      updatedAt: Date.now()
    } as any;

    // Apply local changes
    for (const change of localChanges.added) {
      merged.rules?.push(change);
    }
    for (const change of localChanges.removed) {
      if (merged.rules) {
        merged.rules = merged.rules.filter((r: any) => JSON.stringify(r) !== JSON.stringify(change));
      }
    }

    // Apply remote changes
    for (const change of remoteChanges.added) {
      if (!merged.rules?.find((r: any) => JSON.stringify(r) === JSON.stringify(change))) {
        merged.rules?.push(change);
      }
    }
    for (const change of remoteChanges.removed) {
      if (merged.rules) {
        merged.rules = merged.rules.filter((r: any) => JSON.stringify(r) !== JSON.stringify(change));
      }
    }

    return merged;
  }

  /**
   * Simple merge when no base is available
   */
  private simpleMerge(local: Policy, remote: Policy): Policy {
    // Combine rules from both, removing duplicates
    const allRules = [...(local.rules || []), ...(remote.rules || [])];
    const uniqueRules = Array.from(
      new Map(allRules.map((r: any) => [JSON.stringify(r), r])).values()
    );

    return {
      ...local,
      version: this.incrementVersion(Math.max(
        this.parseVersion(local.version),
        this.parseVersion(remote.version)
      )),
      rules: uniqueRules,
      updatedAt: Date.now()
    } as any;
  }

  /**
   * Get changes between two policies
   */
  private getChanges(base: Policy, modified: Policy): {
    added: any[];
    removed: any[];
    modified: any[];
  } {
    const baseRules = new Set((base.rules || []).map((r: any) => JSON.stringify(r)));
    const modifiedRules = new Set((modified.rules || []).map((r: any) => JSON.stringify(r)));

    const added = (modified.rules || []).filter((r: any) => !baseRules.has(JSON.stringify(r)));
    const removed = (base.rules || []).filter((r: any) => !modifiedRules.has(JSON.stringify(r)));
    const modified_rules: any[] = [];  // Simplified - not tracking modifications

    return { added, removed, modified: modified_rules };
  }

  /**
   * Check if changes conflict
   */
  private hasConflictingChanges(
    localChanges: { added: any[]; removed: any[]; modified: any[] },
    remoteChanges: { added: any[]; removed: any[]; modified: any[] }
  ): boolean {
    // Check if same rule was modified differently
    for (const localMod of localChanges.modified) {
      for (const remoteMod of remoteChanges.modified) {
        if (JSON.stringify(localMod) === JSON.stringify(remoteMod)) {
          return true;
        }
      }
    }

    // Check if one added and other removed same rule
    for (const added of localChanges.added) {
      for (const removed of remoteChanges.removed) {
        if (JSON.stringify(added) === JSON.stringify(removed)) {
          return true;
        }
      }
    }

    for (const added of remoteChanges.added) {
      for (const removed of localChanges.removed) {
        if (JSON.stringify(added) === JSON.stringify(removed)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Parse version string to number
   */
  private parseVersion(version: string): number {
    const parts = version.split('.').map(p => parseInt(p, 10));
    return parts[0] * 10000 + (parts[1] || 0) * 100 + (parts[2] || 0);
  }

  /**
   * Increment version number
   */
  private incrementVersion(versionNum: number): string {
    const major = Math.floor(versionNum / 10000);
    const minor = Math.floor((versionNum % 10000) / 100);
    const patch = (versionNum % 100) + 1;
    
    return `${major}.${minor}.${patch}`;
  }
}

/**
 * VersionControl - Git-like version control for policies
 */
export class VersionControl {
  private branches: Map<string, Map<string, Policy[]>> = new Map();  // actorId -> branchName -> policies

  constructor(
    private storage: MemoryStorage,
    private clock: LamportClock
  ) {}

  /**
   * Create a new branch
   */
  async createBranch(
    actorId: string,
    branchName: string,
    fromVersion?: string
  ): Promise<void> {
    let actorBranches = this.branches.get(actorId);
    if (!actorBranches) {
      actorBranches = new Map();
      this.branches.set(actorId, actorBranches);
    }

    // Get policies from main or specified version
    const sourceBranch = fromVersion || 'main';
    const sourcePolicies = actorBranches.get(sourceBranch) || [];
    
    // Create new branch with copy of source policies
    actorBranches.set(branchName, [...sourcePolicies]);

    // Persist to storage
    await (this.storage as any).addFact({
      id: `version-control:${actorId}:branch:${branchName}`,
      actorId,
      graph_id: actorId,
      type: 'version-control-branch',
      content: JSON.stringify(sourcePolicies),
      validFrom: new Date(),
      confidence: 1.0,
      source: 'version-control'
    });
  }

  /**
   * Get policies in a branch
   */
  async getBranchPolicies(actorId: string, branchName: string): Promise<Policy[]> {
    const actorBranches = this.branches.get(actorId);
    if (!actorBranches) {
      return [];
    }

    return actorBranches.get(branchName) || [];
  }

  /**
   * Tag a version
   */
  async tagVersion(policyId: string, version: string, tag: string): Promise<void> {
    (this.storage as any).addFact({
      id: `version-control:${policyId}:tag:${tag}`,
      actorId: policyId,
      graph_id: policyId,
      type: 'version-control-tag',
      content: JSON.stringify({ tag, version }),
      validFrom: new Date(),
      confidence: 1.0,
      source: 'version-control'
    });
  }

  /**
   * Get version history
   */
  async getVersionHistory(policyId: string): Promise<PolicyVersion[]> {
    const facts = await this.storage.searchFacts({
      actorId: policyId,
      graph_id: policyId,
      limit: 100
    });
    
    const filtered = facts.filter((f: any) =>
      f.type === 'version-control-history' && 
      f.content.includes(policyId)
    );
    
    if (filtered.length === 0) {
      return [];
    }

    try {
      return filtered.map((f: any) => JSON.parse(f.content));
    } catch {
      return [];
    }
  }

  /**
   * Record version
   */
  async recordVersion(version: PolicyVersion): Promise<void> {
    (this.storage as any).addFact({
      id: `version-control:${version.policyId}:history:${version.version}`,
      actorId: version.policyId,
      graph_id: version.policyId,
      type: 'version-control-history',
      content: JSON.stringify(version),
      validFrom: new Date(),
      confidence: 1.0,
      source: 'version-control'
    });
  }
}
