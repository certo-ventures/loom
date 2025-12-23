# TLS Notary for Loom: Architecture & Design Decisions

**Last Updated:** December 18, 2024

## Overview

This document explains the architectural decisions for integrating TLS Notary into the Loom actor framework.

## Design Principles

### 1. **Separation of Concerns**

```
┌──────────────────────────────────────────────────┐
│  Proof Generation (User-Side)                    │
│  - Browser extension                             │
│  - tlsn-js library                              │
│  - Custom Rust integration                       │
│  ➜ Produces: TLSNotaryPresentation              │
└───────────────────┬──────────────────────────────┘
                    │
                    │ JSON/Binary
                    │ (Network/Storage)
                    ▼
┌──────────────────────────────────────────────────┐
│  Proof Verification (Loom-Side)                  │
│  - TypeScript integration layer                  │
│  - Rust WASM verifier (optional, production)     │
│  - Mock verifier (development)                   │
│  ➜ Produces: VerifiedData                       │
└──────────────────────────────────────────────────┘
```

**Why:**
- Loom focuses ONLY on verification, not generation
- Users generate proofs with their own tools
- Clean boundary: Loom never sees credentials
- Portable proofs work with any verifier

### 2. **Progressive Enhancement**

```
Development          Testing              Production
    │                   │                     │
    ▼                   ▼                     ▼
MockVerifier  ──→  MockVerifier  ──→  WasmVerifier
(Always works)    (With warnings)     (Real crypto)
```

**Why:**
- Start development immediately (no Rust required)
- Test workflows with mock verification
- Deploy WASM when ready (no code changes)
- Clear warnings prevent accidental production use

### 3. **Actor-Centric Integration**

```typescript
// Actors use TLS Notary as a capability

class BankStatementActor extends TLSNotaryActor {
  async execute(input: { proof: TLSNotaryPresentation }) {
    // Verify proof
    const verified = await this.verifyPresentation(input.proof)
    
    // Process verified data
    const balance = this.extractBalance(verified.data)
    
    // Store with audit trail
    this.state.verified_balances.set(verified.server_name, {
      balance,
      proof_hash: verified.proof_hash,
      timestamp: verified.timestamp
    })
  }
}
```

**Why:**
- Verification is just another actor capability
- Composable with existing actors
- Stateful verification history
- Audit trail built-in

## Key Architectural Decisions

### Decision 1: Two Verifier Implementations

**Options Considered:**
1. ❌ Only WASM (blocks development until Rust ready)
2. ❌ Only Mock (unsafe for production)
3. ✅ **Both with runtime selection**

**Decision:** Dual implementation with factory pattern

**Rationale:**
- Unblocks TypeScript development
- Provides clear migration path
- Factory automatically uses best available
- Explicit warnings prevent confusion

```typescript
// Automatically uses WASM if available
const verifier = await createVerifier()

// Force mock for testing
const mockVerifier = await createVerifier({ preferMock: true })
```

### Decision 2: Presentation Format

**Options Considered:**
1. ❌ Custom Loom format (incompatible with ecosystem)
2. ❌ Raw TLS session data (too low-level)
3. ✅ **Standard TLS Notary Presentation format**

**Decision:** Use tlsn crate's `Presentation` structure

**Rationale:**
- Compatible with tlsn-js, browser extension
- Standard format enables ecosystem tools
- No conversion needed
- Future-proof as protocol evolves

```typescript
interface TLSNotaryPresentation {
  version: string
  header: SessionHeader      // From tlsn-core
  signature: NotarySignature
  session: SessionData       // Revealed transcript
}
```

### Decision 3: Actor Base Class vs Mixin

**Options Considered:**
1. ✅ **Base class: `TLSNotaryActor`**
2. ❌ Mixin function
3. ❌ Service injection

**Decision:** Base class with `initializeVerifier()` and `verifyPresentation()`

**Rationale:**
- Clear inheritance relationship
- TypeScript types work well
- Easy to understand
- Familiar pattern (like `AIActor`)

```typescript
class MyActor extends TLSNotaryActor {
  // Inherits verifyPresentation(), initializeVerifier()
}
```

### Decision 4: Synchronous vs Async Verification

**Decision:** Fully async verification

**Rationale:**
- WASM loading is async
- Crypto operations may be slow (MPC overhead)
- Consistent with Actor execute() pattern
- Allows future optimizations (worker threads)

```typescript
// All verification is async
const result = await actor.verifyPresentation(proof)
```

### Decision 5: State Management for Verified Data

**Decision:** Actors store verified data in their state with audit trail

**Example:**
```typescript
interface VerifiedDataState {
  verified_sources: Map<string, VerifiedData>
  proof_history: Array<{
    proof_hash: string
    timestamp: number
    result: boolean
    server_name: string
  }>
}
```

**Rationale:**
- Audit trail for compliance
- Historical data for analysis
- Proof hashes prevent replay attacks
- Compatible with journal/snapshot system

### Decision 6: Error Handling Strategy

**Decision:** Fail-fast with detailed errors

```typescript
try {
  const verified = await actor.verifyPresentation(proof)
} catch (error) {
  if (error.message.includes('signature')) {
    // Invalid cryptographic signature
  } else if (error.message.includes('certificate')) {
    // Certificate chain validation failed
  } else if (error.message.includes('commitment')) {
    // Merkle proof validation failed
  }
}
```

**Rationale:**
- Security-critical operation
- Invalid proof = reject immediately
- Detailed errors aid debugging
- No partial verification

### Decision 7: Mock Verifier Warnings

**Decision:** Always log warnings, require acknowledgment in production

```typescript
if (process.env.NODE_ENV === 'production' && verifier.getInfo().type === 'mock') {
  throw new Error('MockVerifier not allowed in production. Set ALLOW_MOCK_VERIFIER=true to override')
}
```

**Rationale:**
- Prevent accidental production use
- Explicit opt-in for demos
- Clear visual warnings in logs
- Environment-aware safety

## Integration Patterns

### Pattern 1: Single Verification

**Use Case:** Verify one proof, use data

```typescript
class SimpleVerificationActor extends TLSNotaryActor {
  async execute(input: { proof: TLSNotaryPresentation }) {
    const verified = await this.verifyPresentation(input.proof)
    return verified.data
  }
}
```

### Pattern 2: Batch Verification

**Use Case:** Verify multiple proofs from different sources

```typescript
class AggregatorActor extends TLSNotaryActor {
  async execute(input: { proofs: TLSNotaryPresentation[] }) {
    const results = await Promise.all(
      input.proofs.map(proof => this.verifyPresentation(proof))
    )
    
    // Check all from different servers
    const servers = new Set(results.map(r => r.server_name))
    if (servers.size !== results.length) {
      throw new Error('Proofs must be from different servers')
    }
    
    return this.aggregateData(results)
  }
}
```

### Pattern 3: Multi-Notary Verification

**Use Case:** Require proofs from multiple notaries

```typescript
class MultiNotaryActor extends TLSNotaryActor {
  async execute(input: { 
    proofs: TLSNotaryPresentation[],
    requiredNotaries: string[]  // Public keys
  }) {
    const verified = await Promise.all(
      input.proofs.map(proof => this.verifyPresentation(proof))
    )
    
    // Check all required notaries signed
    const notaries = new Set(verified.map(v => v.notary_pubkey))
    const hasAll = input.requiredNotaries.every(n => notaries.has(n))
    
    if (!hasAll) {
      throw new Error('Not all required notaries provided')
    }
    
    // Check all proofs show same data (within tolerance)
    this.verifyConsistency(verified)
    
    return verified[0].data  // All match, return any
  }
}
```

### Pattern 4: Streaming Verification

**Use Case:** Verify proofs as they arrive

```typescript
class StreamingVerificationActor extends TLSNotaryActor {
  private pendingProofs = new Map<string, TLSNotaryPresentation>()
  
  async execute(input: { 
    action: 'add-proof' | 'verify-all',
    proof?: TLSNotaryPresentation
  }) {
    if (input.action === 'add-proof' && input.proof) {
      const hash = this.hashProof(input.proof)
      this.pendingProofs.set(hash, input.proof)
      return { queued: hash }
    }
    
    if (input.action === 'verify-all') {
      const results = []
      for (const [hash, proof] of this.pendingProofs) {
        try {
          const verified = await this.verifyPresentation(proof)
          results.push({ hash, verified })
        } catch (error) {
          results.push({ hash, error: error.message })
        }
      }
      this.pendingProofs.clear()
      return results
    }
  }
}
```

## Security Considerations

### 1. Trust Boundaries

```
┌─────────────────────────────────────────────────┐
│  Untrusted: User-Provided Proof                 │
│  ➜ Could be forged, replayed, or invalid       │
└───────────────────┬─────────────────────────────┘
                    │
                    ▼
           ┌────────────────┐
           │  Verification  │  ← Trust boundary
           │   (Crypto)     │
           └────────┬───────┘
                    │
                    ▼
┌─────────────────────────────────────────────────┐
│  Trusted: Verified Data                         │
│  ➜ Cryptographically proven provenance         │
└─────────────────────────────────────────────────┘
```

### 2. Replay Attack Prevention

**Store proof hashes to detect replays:**

```typescript
if (this.state.proof_history.some(p => p.proof_hash === verified.proof_hash)) {
  throw new Error('Proof already used (replay attack)')
}
```

### 3. Timestamp Validation

**Reject old proofs:**

```typescript
const age = Date.now() - verified.timestamp * 1000
if (age > MAX_PROOF_AGE_MS) {
  throw new Error('Proof too old')
}
```

### 4. Server Whitelist

**Only accept proofs from trusted servers:**

```typescript
const ALLOWED_SERVERS = ['api.bank.com', 'api.brokerage.com']
if (!ALLOWED_SERVERS.includes(verified.server_name)) {
  throw new Error('Proof from untrusted server')
}
```

## Performance Considerations

### WASM Initialization

**Problem:** Loading WASM adds startup latency

**Solution:** Lazy initialization, shared instance

```typescript
// Singleton verifier instance
let sharedVerifier: TLSNotaryVerifier | null = null

export async function getSharedVerifier(): Promise<TLSNotaryVerifier> {
  if (!sharedVerifier) {
    sharedVerifier = await createVerifier()
  }
  return sharedVerifier
}
```

### Batch Processing

**Problem:** Verifying many proofs sequentially is slow

**Solution:** Parallel verification

```typescript
// Verify up to 10 proofs concurrently
const results = await Promise.all(
  proofs.map(proof => this.verifyPresentation(proof))
)
```

### Caching

**Problem:** Re-verifying same proof is wasteful

**Solution:** Cache verified results

```typescript
private verifiedCache = new Map<string, VerifiedData>()

async verifyPresentation(proof: TLSNotaryPresentation) {
  const hash = this.hashProof(proof)
  
  if (this.verifiedCache.has(hash)) {
    return this.verifiedCache.get(hash)!
  }
  
  const verified = await super.verifyPresentation(proof)
  this.verifiedCache.set(hash, verified)
  
  return verified
}
```

## Testing Strategy

### Unit Tests

- Mock verifier behavior
- Presentation structure validation
- Error handling
- State management

### Integration Tests

- Real TLS Notary presentations (from test suite)
- WASM verifier (if available)
- Actor workflows
- Multi-actor coordination

### End-to-End Tests

- Browser extension → Loom verification
- tlsn-js → Loom verification
- Multiple notaries
- Replay attack prevention

## Migration Path

### Phase 1: Development (Now)
- ✅ TypeScript integration layer
- ✅ Mock verifier
- ✅ Actor base class
- ✅ Documentation

### Phase 2: Testing (1-2 weeks)
- ⏳ Example actors
- ⏳ Integration tests
- ⏳ Performance benchmarks
- ⏳ Security audit

### Phase 3: Production (When Rust ready)
- ⏳ Rust WASM verifier
- ⏳ Build pipeline
- ⏳ WASM optimization
- ⏳ Production deployment

### Phase 4: Enhancement (Future)
- ⏳ Worker thread verification
- ⏳ Batch optimization
- ⏳ Advanced ZK proofs
- ⏳ On-chain verification

## Comparison with Alternatives

### vs. Direct Rust Integration

| Aspect | TLS Notary | Direct Rust |
|--------|-----------|-------------|
| **Complexity** | High (MPC-TLS) | Low |
| **Proof Size** | Large (~MB) | N/A |
| **Privacy** | Excellent (selective disclosure) | N/A |
| **Ecosystem** | Growing | N/A |
| **Performance** | Moderate | Fast |

**Verdict:** TLS Notary needed for cryptographic data provenance

### vs. Oracle Services

| Aspect | TLS Notary | Oracle |
|--------|-----------|--------|
| **Trust** | Minimal (crypto) | High (service provider) |
| **Privacy** | High (user controls) | Low (oracle sees all) |
| **Cost** | Low (self-hosted) | Variable |
| **Latency** | Higher (MPC) | Lower |

**Verdict:** TLS Notary for private data, Oracles for public data

### vs. zkTLS (Proxy-based)

| Aspect | TLS Notary | zkTLS Proxy |
|--------|-----------|-------------|
| **Network Assumption** | None | Proxy must be available |
| **Censorship Resistance** | High | Lower |
| **Privacy** | Excellent | Good |
| **Complexity** | High (MPC) | Lower (ZK only) |

**Verdict:** TLS Notary more robust, zkTLS more efficient for specific use cases

## Future Enhancements

### 1. On-Chain Verification

**Goal:** Verify TLS Notary proofs in smart contracts

**Approach:**
- Generate SNARK proof of verification
- Submit to blockchain
- Smart contract validates SNARK

### 2. Advanced ZK Proofs

**Goal:** Prove properties without revealing data

**Example:**
```typescript
// Prove age > 21 without revealing birthdate
const zkProof = await actor.generateZKProof(verified, {
  statement: 'age > 21',
  publicInputs: ['age_threshold'],
  privateInputs: ['birthdate']
})
```

### 3. Distributed Notary Network

**Goal:** Decentralized notary service

**Approach:**
- Multiple notaries sign same session
- Threshold signatures (t-of-n)
- Reputation system

### 4. Credential Encryption (FHE/ZK)

**Goal:** Never expose credentials even during proof generation

**Approach:**
- Encrypt credentials with FHE
- Generate ZK proof of validity
- Notary operates on encrypted data

## Conclusion

This architecture provides:
- ✅ Clean separation of concerns
- ✅ Progressive enhancement (mock → WASM)
- ✅ Actor-centric integration
- ✅ Security by default
- ✅ Clear migration path

**Next:** See [IMPLEMENTATION.md](./IMPLEMENTATION.md) for code details
