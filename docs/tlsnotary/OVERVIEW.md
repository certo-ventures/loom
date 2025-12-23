# TLS Notary Overview

**Last Updated:** December 18, 2024  
**Source:** https://tlsnotary.org/

## What is TLS Notary?

TLS Notary is an open-source protocol that enables **cryptographic proof of data provenance** from any HTTPS source while preserving privacy through selective disclosure.

### The Core Problem

TLS (Transport Layer Security) secures communication between a server and user, but:
- TLS uses **symmetric keys** - user can modify data and recompute checksums
- There's **no way to prove to a third party** that data came from a specific server
- User has full control over TLS session keys and could forge responses

### The TLS Notary Solution

**Add a Verifier/Notary to the TLS connection using Multi-Party Computation (MPC)**

```
┌─────────┐         MPC          ┌──────────┐
│ Prover  │◄────────────────────►│ Verifier │
│ (User)  │                      │/Notary   │
└────┬────┘                      └──────────┘
     │
     │ Standard TLS
     │ (Server sees normal connection)
     ▼
┌─────────┐
│ Server  │
│ (Bank,  │
│  API)   │
└─────────┘
```

## How It Works: 3-Phase Protocol

### Phase 1: Multi-Party TLS Request

**The Prover and Verifier jointly operate the TLS connection using MPC**

- Neither party has full access to TLS session keys
- **Prover** communicates with server (server sees normal TLS connection)
- **Verifier** participates via secure MPC without seeing plaintext
- Keys are "split" between both parties preventing forgery

**What the Verifier sees during this phase:**
- ✅ Time of TLS session
- ✅ Length of requests/responses
- ✅ Number of round trips
- ✅ Cipher suite used
- ❌ **Does NOT see:** Plaintext data or server identity

### Phase 2: Selective Disclosure

**The Prover creates commitments and selectively reveals data**

- Prover can **redact sensitive information** (credentials, personal data)
- Only chosen portions are revealed to verifier
- Can be combined with Zero-Knowledge Proofs to prove properties without revealing data

### Phase 3: Data Verification

**The Verifier validates the proof**

- Verifies cryptographic signatures
- Checks server certificate via trusted CAs
- Makes assertions about non-redacted content
- Data origin confirmed through certificate chain

## Two Operational Modes

### Mode 1: Direct Verifier (Interactive)

**Verifier directly participates in TLS connection**

```
Prover ◄──MPC──► Verifier ◄──────► Server
   │                                   
   └──────────► Proof shared ─────────► Application
```

**Use when:**
- Verifier can participate in real-time
- Direct trust relationship exists
- Maximum control over verification

### Mode 2: General-Purpose Notary (Portable)

**Notary signs attestation, making proof portable and reusable**

```
① Prover ◄──MPC──► Notary        ② Notary signs attestation
         │                                ↓
         └──► Signed proof ──► Store → Share → Any Verifier
                                              ③ Verifies signature
```

**Use when:**
- Verifier cannot participate during TLS session
- Need portable, reusable proofs
- Multiple verifiers need same proof
- Proof stored for future verification

**Notary signs "Session Header" containing:**
- Prover's commitment to plaintext (without seeing it)
- Commitment to TLS data identifying server
- Cryptographic signature over commitments

## Key Properties

### Privacy-Preserving

- **Selective disclosure:** Only reveal what you choose
- **Notary blind:** Notary never sees plaintext or server identity
- **Zero-Knowledge compatible:** Prove properties without revealing data

### Cryptographically Secure

- **No trust assumptions:** No reliance on secure hardware or honest participants
- **Malicious security:** Malicious prover cannot forge data, malicious verifier cannot learn private data
- **Certificate verification:** Standard CA chains validate server identity

### Transparent to Server

- Server sees standard TLS 1.2 connection
- No server-side modifications needed
- Works with any HTTPS endpoint

## What You Can Prove

TLS Notary enables cryptographic proof of:

- ✅ Account ownership on platforms (Twitter, GitHub, etc.)
- ✅ Website content on specific date
- ✅ Private information (address, birth date, health records)
- ✅ Bank transfers without revealing credentials
- ✅ Private messages
- ✅ Online purchases
- ✅ Platform actions (being blocked, earning certificates)
- ✅ API responses from any HTTPS service

**Note:** TLS Notary does NOT solve the "Oracle Problem" for public data. For public data, existing oracle solutions are more efficient.

## Current Status (December 2024)

### Supported
- ✅ **TLS 1.2** (universally deployed)
- ✅ Rust implementation (`tlsn` crate)
- ✅ Browser extension (Chrome)
- ✅ JavaScript library (`tlsn-js`)
- ✅ Interactive verification
- ✅ Attestation/notarization mode

### Roadmap
- ⏳ **TLS 1.3** support (planned when web transitions)
- ⏳ On-chain verification (upgrades planned)
- ⏳ Richer ZK statements (currently hash commitments only)

## Performance Characteristics

### Bandwidth Overhead

**MPC requires significant bandwidth (orders of magnitude more than server data)**

**Planned 2025 protocol upgrade estimates:**

```
Fixed cost: ~25MB per session
Outgoing:   ~10MB per 1KB sent
Incoming:   ~40KB per 1KB received

Example (1KB request + 100KB response):
Total overhead: ~39MB upload
```

### Timing Considerations

- MPC adds latency to TLS connection
- Server timeouts possible with slow connections
- Timing patterns may differ from normal TLS (statistical fingerprinting possible)
- **Always build with `--release`** - debug builds are significantly slower

## Trust Model

### What to Trust

**Verifier must trust:**
- ✅ The Notary (if using notary mode) - must not collude with prover
- ✅ The Server/data source - data itself must be authentic
- ✅ Certificate Authorities - standard TLS trust model
- ✅ Validity of redactions - what was hidden doesn't change meaning

**Verifier does NOT need to trust:**
- ❌ The Prover - cannot forge data
- ❌ Communication channel - no tampering assumptions
- ❌ Secure hardware - purely cryptographic security

### Multiple Notaries

To rule out collusion, verifiers can:
- Require proofs from **multiple independent notaries**
- Each notary independently verifies the same session
- All signatures must validate

## Zero-Knowledge Integration

### Current Support (QuickSilver)

**TLS Notary uses QuickSilver proving system for ZK commitments**

- **Interactive protocol** (not zkSNARK)
- Efficient proof generation and memory usage
- Natural fit for MPC-TLS interactive flow
- Currently: Prove hash commitments in zero-knowledge

### Future Support

**Can integrate with general-purpose ZK systems:**

1. Generate hash commitment with TLS Notary
2. Hand commitment to system like **Noir**
3. Open commitment and prove arbitrary properties

**Planned:** Richer statement support beyond hash commitments

## Related Technologies

### Browser Extension
- Chrome extension for in-browser proofs
- Requires WebSocket proxy (browsers don't allow TCP from extensions)
- PSE hosts public proxy (limited domain whitelist)
- Can run local proxy for other domains

### tlsn-js Library
- NPM module for React/TypeScript apps
- Programmatic proof generation
- Integration examples available

### Rust Implementation
- Core protocol: `https://github.com/tlsnotary/tlsn`
- Main library in `crates/tlsn`
- Examples in `crates/examples`
- **⚠️ Alpha status:** Not production-ready, expect breaking changes

## Development & Community

- **Developed by:** Privacy Stewards of Ethereum (PSE), Ethereum Foundation
- **History:** Originally created 10+ years ago, rebuilt in Rust 2022
- **License:** Dual MIT/Apache 2.0
- **Repository:** https://github.com/tlsnotary/tlsn
- **Documentation:** https://tlsnotary.org/docs/intro
- **Demo:** https://demo.tlsnotary.org/
- **Discord:** https://discord.gg/9XwESXtcN7

## Key Differences from Other Approaches

TLS Notary distinguishes itself through:

1. **Open-source, public good** - no business model
2. **Trustlessness priority** - maximum security/privacy
3. **No network assumptions** - direct connection, not proxy-based
4. **Privacy-first** - never compromises privacy for performance
5. **Community-driven** - transparent development

## For Loom Integration

**See related documentation:**
- [Integration Guide](./INTEGRATION_GUIDE.md) - How to integrate with Loom
- [Architecture Decisions](./ARCHITECTURE.md) - Design choices for Loom
- [Implementation Plan](./IMPLEMENTATION.md) - Step-by-step implementation

**Key considerations for Loom:**
- Rust WASM module required for real verification
- Mock implementation acceptable for development
- Clear separation between proof generation (user-side) and verification (Loom-side)
- Notary mode recommended for autonomous agents
- Portable proofs enable multi-verifier scenarios
