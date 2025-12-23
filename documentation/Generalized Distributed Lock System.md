 Generalized Distributed Lock System - Design Proposal

**Status:** Proposal for Future Implementation  
**Date:** December 18, 2025  
**Current System:** Simple key-based locks with `LockKeys` helper

---

## Executive Summary

Proposal for a generalized distributed lock system using a **subject/predicate model** to replace the current simple key-based approach. This would provide better structure, discoverability, policy enforcement, and monitoring capabilities as the system scales.

**Recommendation:** Implement when we have 15+ lock types or need advanced features like shared locks, lock hierarchies, or complex querying.

---

## Current System

### Implementation

```typescript
// DistributedLockService.ts - Simple Redis-based locks
export const LockKeys = {
    consolidation: (fileSetId: string, documentType: string) =>
        `consolidation:${fileSetId}:${documentType}`,
    
    fileSetProcessing: (fileSetId: string) =>
        `fileset-processing:${fileSetId}`,
    
    documentProcessing: (fileSetId: string, fileName: string) =>
        `document-processing:${fileSetId}:${fileName}`,
    
    schemaUpdate: (tenantId: string, documentType: string) =>
        `schema-update:${tenantId}:${documentType}`,
    
    queueProcessing: (queueName: string, jobId: string) =>
        `queue-processing:${queueName}:${jobId}`
};

// Usage
const lockKey = LockKeys.consolidation(fileSetId, documentType);
await lockService.acquireLock(lockKey, { ttl: 60000 });
```

### Current Usage

**Active Locks (Production):**
- ✅ `consolidation` - Prevents duplicate consolidation triggers (ConsolidationCoordinator)
- ✅ `status-reconciliation-audit` - Prevents concurrent audits (StatusReconciliationService)

**Defined But Unused:**
- `fileSetProcessing` - Reserved for FileSet-level operations
- `documentProcessing` - Reserved for document-level operations  
- `schemaUpdate` - Reserved for schema modifications
- `queueProcessing` - Reserved for queue job deduplication

### Strengths

✅ Simple and explicit  
✅ Fast string construction  
✅ Easy to debug (readable Redis keys)  
✅ No abstraction overhead  
✅ Works well for < 10 lock types

### Limitations

❌ No standardization across lock types  
❌ Hard to query patterns (e.g., "all consolidation locks")  
❌ No metadata about purpose/scope  
❌ Requires manual key pattern definition  
❌ No policy enforcement  
❌ No lock hierarchy support

---

## Proposed Generalized System

### Architecture Overview

**Core Concept:** Model locks using **Subject** (what) + **Predicate** (action/state) + **Resources** (identifiers)

```
Lock Key Format:
lock:{lockType}:{subject}:{predicate}:{resource1}:{resource2}:...

Examples:
- lock:exclusive:consolidation-job:triggering:fs-abc123:VA-IRRL-LIN
- lock:exclusive:page:extracting:fs-abc123:doc-456:3
- lock:shared:schema:reading:tenant-123:VA-IRRL-LIN
- lock:intent:fileset:processing:fs-abc123
```

### Core Enumerations

```typescript
// What is being locked
enum LockSubject {
    FILESET = 'fileset',
    DOCUMENT = 'document',
    PAGE = 'page',
    CONSOLIDATION_JOB = 'consolidation-job',
    EXTRACTION_JOB = 'extraction-job',
    SCHEMA = 'schema',
    QUEUE_JOB = 'queue-job',
    AUDIT = 'audit'
}

// What action/state is being protected
enum LockPredicate {
    PROCESSING = 'processing',        // General processing
    READING = 'reading',              // Read operation
    WRITING = 'writing',              // Write operation
    TRIGGERING = 'triggering',        // Trigger/start operation
    COMPLETING = 'completing',        // Completion operation
    VALIDATING = 'validating',        // Validation operation
    CONSOLIDATING = 'consolidating',  // Consolidation
    EXTRACTING = 'extracting'         // Extraction
}

// How the lock behaves
enum LockType {
    EXCLUSIVE = 'exclusive',  // Only one holder (current behavior)
    SHARED = 'shared',        // Multiple readers allowed
    INTENT = 'intent'         // Intent to acquire stronger lock
}
```

### Lock Descriptor Interface

```typescript
interface LockDescriptor {
    subject: LockSubject;              // WHAT (required)
    predicate: LockPredicate;          // ACTION (required)
    resourceId: string | string[];     // WHO/WHICH (required)
    lockType?: LockType;               // HOW (default: EXCLUSIVE)
    ttl?: number;                      // Expiry (default: 30s)
    metadata?: Record<string, any>;    // Additional context
}
```

### Generalized Lock Manager

```typescript
class GeneralizedLockManager {
    private lockService: DistributedLockService;
    
    /**
     * Build lock key from descriptor
     */
    private buildLockKey(descriptor: LockDescriptor): string {
        const { subject, predicate, resourceId, lockType = LockType.EXCLUSIVE } = descriptor;
        const resources = Array.isArray(resourceId) ? resourceId : [resourceId];
        
        return [
            'lock',
            lockType,
            subject,
            predicate,
            ...resources
        ].join(':');
    }
    
    /**
     * Acquire lock with descriptor
     */
    async acquire(descriptor: LockDescriptor): Promise<LockResult> {
        const lockKey = this.buildLockKey(descriptor);
        return await this.lockService.acquireLock(lockKey, {
            ttl: descriptor.ttl,
            ...descriptor.metadata
        });
    }
    
    /**
     * Release lock with descriptor
     */
    async release(descriptor: LockDescriptor, lockId: string): Promise<boolean> {
        const lockKey = this.buildLockKey(descriptor);
        return await this.lockService.releaseLock(lockKey, lockId);
    }
    
    /**
     * Execute function with lock protection
     */
    async executeWithLock<T>(
        descriptor: LockDescriptor,
        fn: () => Promise<T>
    ): Promise<T> {
        const lockKey = this.buildLockKey(descriptor);
        return await this.lockService.executeWithLock(lockKey, fn, {
            ttl: descriptor.ttl
        });
    }
    
    /**
     * Query active locks by pattern
     */
    async findLocks(pattern: Partial<LockDescriptor>): Promise<string[]> {
        // Build Redis SCAN pattern from partial descriptor
        const parts = ['lock'];
        parts.push(pattern.lockType || '*');
        parts.push(pattern.subject || '*');
        parts.push(pattern.predicate || '*');
        parts.push('*'); // Resources wildcard
        
        return await this.scanRedisKeys(parts.join(':'));
    }
}
```

---

## Migration Examples

### Consolidation Lock

**Current:**
```typescript
const lockKey = LockKeys.consolidation(fileSetId, documentType);
await lockService.acquireLock(lockKey, { ttl: 60000 });
```

**Proposed:**
```typescript
await lockManager.acquire({
    subject: LockSubject.CONSOLIDATION_JOB,
    predicate: LockPredicate.TRIGGERING,
    resourceId: [fileSetId, documentType],
    lockType: LockType.EXCLUSIVE,
    ttl: 60000,
    metadata: {
        purpose: 'Prevent duplicate consolidation triggers',
        scope: 'document-type'
    }
});
```

### Status Reconciliation Audit

**Current:**
```typescript
await lockService.executeWithLock(
    'status-reconciliation-audit',
    async () => { /* audit logic */ },
    { ttl: 300000 }
);
```

**Proposed:**
```typescript
await lockManager.executeWithLock({
    subject: LockSubject.AUDIT,
    predicate: LockPredicate.PROCESSING,
    resourceId: 'status-reconciliation',
    lockType: LockType.EXCLUSIVE,
    ttl: 300000
}, async () => {
    // audit logic
});
```

### Page Extraction (New Pattern)

**Proposed:**
```typescript
// Lock at page level during extraction
await lockManager.acquire({
    subject: LockSubject.PAGE,
    predicate: LockPredicate.EXTRACTING,
    resourceId: [fileSetId, documentId, pageNumber.toString()],
    ttl: 120000
});
```

### Schema Updates (New Pattern)

**Proposed:**
```typescript
// Exclusive write lock for schema updates
await lockManager.acquire({
    subject: LockSubject.SCHEMA,
    predicate: LockPredicate.WRITING,
    resourceId: [tenantId, documentType],
    lockType: LockType.EXCLUSIVE,
    ttl: 30000
});

// Shared read lock for schema queries
await lockManager.acquire({
    subject: LockSubject.SCHEMA,
    predicate: LockPredicate.READING,
    resourceId: [tenantId, documentType],
    lockType: LockType.SHARED,  // Multiple readers allowed
    ttl: 5000
});
```

---

## Advanced Features

### 1. Lock Discovery & Monitoring

```typescript
// Find all active consolidation locks
const consolidationLocks = await lockManager.findLocks({
    subject: LockSubject.CONSOLIDATION_JOB,
    predicate: LockPredicate.TRIGGERING
});

// Find all locks for a specific FileSet
const fileSetLocks = await lockManager.findLocks({
    resourceId: fileSetId
});

// Get metrics grouped by subject
const metrics = await lockManager.getMetrics();
// {
//   'consolidation-job': { count: 3, avgTTL: 60000 },
//   'page': { count: 45, avgTTL: 120000 }
// }
```

### 2. Lock Policy Enforcement

```typescript
class LockPolicyEngine {
    validateLockRequest(descriptor: LockDescriptor): ValidationResult {
        // Enforce business rules
        
        if (descriptor.subject === LockSubject.PAGE && 
            descriptor.predicate === LockPredicate.EXTRACTING) {
            // Page extraction should have reasonable TTL
            if (!descriptor.ttl || descriptor.ttl > 300000) {
                return { 
                    valid: false, 
                    reason: 'Extraction TTL exceeds 5 minutes' 
                };
            }
        }
        
        if (descriptor.subject === LockSubject.AUDIT) {
            // Audits must be exclusive
            if (descriptor.lockType !== LockType.EXCLUSIVE) {
                return { 
                    valid: false, 
                    reason: 'Audits require exclusive locks' 
                };
            }
        }
        
        return { valid: true };
    }
}
```

### 3. Lock Hierarchies (Intent Locks)

```typescript
// Signal intent to modify FileSet (doesn't block reads)
await lockManager.acquire({
    subject: LockSubject.FILESET,
    predicate: LockPredicate.PROCESSING,
    resourceId: fileSetId,
    lockType: LockType.INTENT  // Intent lock
});

// Then acquire fine-grained page locks
for (const page of pages) {
    await lockManager.acquire({
        subject: LockSubject.PAGE,
        predicate: LockPredicate.WRITING,
        resourceId: [fileSetId, page.id],
        lockType: LockType.EXCLUSIVE
    });
}
```

### 4. Shared Read Locks

```typescript
// Multiple workers can read schema simultaneously
await lockManager.acquire({
    subject: LockSubject.SCHEMA,
    predicate: LockPredicate.READING,
    resourceId: [tenantId, documentType],
    lockType: LockType.SHARED,  // Allow concurrent readers
    ttl: 5000
});

// But write locks are exclusive
await lockManager.acquire({
    subject: LockSubject.SCHEMA,
    predicate: LockPredicate.WRITING,
    resourceId: [tenantId, documentType],
    lockType: LockType.EXCLUSIVE,  // Block all readers/writers
    ttl: 30000
});
```

---

## When to Migrate

### Migrate When You Have:

⚠️ **15+ different lock types** becoming hard to track  
⚠️ Need to **query locks by pattern** (e.g., "all consolidation locks")  
⚠️ Want to **enforce lock policies** programmatically  
⚠️ Need **complex lock hierarchies** (FileSet → Document → Page)  
⚠️ Want to implement **shared/intent locks**  
⚠️ Need **detailed lock metrics** and monitoring  
⚠️ Multiple teams adding locks without coordination

### Stay With Current System If:

✅ **< 10 lock types** and simple patterns  
✅ **No complex queries** needed  
✅ **Explicit is better** than abstract for your team  
✅ **No shared/intent locks** required  
✅ Current system meets all needs

---

## Implementation Phases

### Phase 1: Foundation (1-2 weeks)
- Implement `LockDescriptor` interface
- Create `GeneralizedLockManager` class
- Build lock key generation from descriptors
- Add basic query support (`findLocks`)
- Write comprehensive tests

### Phase 2: Migration (2-3 weeks)
- Migrate consolidation locks (highest priority)
- Migrate audit locks
- Add lock policy validation
- Update monitoring/diagnostics
- Parallel run with current system

### Phase 3: Advanced Features (1-2 weeks)
- Implement shared locks
- Add intent locks
- Build lock metrics dashboard
- Create lock policy engine
- Document best practices

### Phase 4: Deprecation (1 week)
- Remove old `LockKeys` pattern
- Update all documentation
- Train team on new patterns
- Monitor production usage

---

## Performance Considerations

### Redis Key Structure Impact

**Current:**
```
consolidation:fs-abc123:VA-IRRL-LIN  (38 bytes)
```

**Proposed:**
```
lock:exclusive:consolidation-job:triggering:fs-abc123:VA-IRRL-LIN  (65 bytes)
```

**Impact:** +70% key size, negligible for Redis (keys are typically < 1KB)

### Lock Operations Performance

- **Acquire:** Same (single Redis SET NX operation)
- **Release:** Same (single Redis Lua script)
- **Query:** Slower (requires SCAN, but only for monitoring)

**Conclusion:** Performance impact is minimal, mostly in key storage

---

## Monitoring & Observability

### Metrics to Track

```typescript
interface LockMetrics {
    activeCount: number;              // Current active locks
    acquisitionRate: number;          // Locks/second
    averageTTL: number;              // Average lock duration
    contentionRate: number;          // Failed acquisitions/second
    bySubject: Map<string, number>;  // Locks per subject
    byPredicate: Map<string, number>; // Locks per predicate
}
```

### Dashboard Queries

```typescript
// Locks by subject (pie chart)
SELECT subject, COUNT(*) FROM active_locks GROUP BY subject

// Lock duration histogram
SELECT ttl_bucket, COUNT(*) FROM active_locks 
GROUP BY FLOOR(ttl / 10000)

// High contention locks
SELECT key, failed_acquisitions FROM lock_stats 
WHERE failed_acquisitions > 10
ORDER BY failed_acquisitions DESC
```

---

## Alternatives Considered

### 1. Keep Current System Forever
**Pros:** Simple, works, no migration cost  
**Cons:** Doesn't scale to complex locking needs  
**Verdict:** Good for small systems, limiting for growth

### 2. Use External Service (Zookeeper, etcd, Consul)
**Pros:** Battle-tested, advanced features, strong consistency  
**Cons:** Additional infrastructure, complexity, latency  
**Verdict:** Overkill for our use case

### 3. Database-Level Locks
**Pros:** Integrated with data layer, ACID guarantees  
**Cons:** Slower, ties locks to DB, less flexible  
**Verdict:** Not suitable for high-throughput operations

### 4. Generalized System (This Proposal)
**Pros:** Balanced abstraction, Redis-based (existing), extensible  
**Cons:** Migration effort, learning curve  
**Verdict:** ✅ Best fit for growth while keeping simplicity

---

## References

- [Redis Distributed Locks (Redlock)](https://redis.io/docs/manual/patterns/distributed-locks/)
- [Martin Kleppmann on Distributed Locks](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)
- Current implementation: `services/backend-api/src/services/DistributedLockService.ts`
- Current usage: `services/backend-api/src/services/ConsolidationCoordinator.ts`

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2025-12-18 | Proposal documented | System growing, considering future needs |
| TBD | Approval/rejection | Based on lock type count and feature needs |
| TBD | Implementation start | When we hit 15+ lock types or need advanced features |

---

**Next Steps:**
1. Review proposal with team
2. Monitor lock type growth (alert at 12+ types)
3. Evaluate need for shared/intent locks
4. Revisit quarterly or when limitations hit
