# TLS Notary Reference - Technical Details

**Last Updated:** December 18, 2024  
**Source:** https://tlsnotary.org/ + https://github.com/tlsnotary/tlsn

## Protocol Specification

### MPC-TLS Protocol

**Core Innovation:** Split TLS session keys between Prover and Verifier using secure multi-party computation

#### Key Generation Phase

```
Server           Prover           Verifier
  │                │                 │
  │←───Handshake──→│                 │
  │                │◄──────MPC──────►│
  │                │   Share keys    │
  │                │                 │
  │  Prover has:   │  Verifier has:  │
  │  - Key share A │  - Key share B  │
  │  - Cannot      │  - Cannot       │
  │    decrypt     │    decrypt      │
  │    alone       │    alone        │
```

**Security Property:** Neither Prover nor Verifier can:
- Forge server responses (need both key shares)
- Decrypt without the other party
- Learn the other's key share

#### Encryption/Decryption

**TLS uses symmetric AES-GCM:**
```
Plaintext ──[Key]──> Ciphertext

Traditional TLS:
  Key = PRF(master_secret)
  
MPC-TLS:
  Key_A = PRF(master_secret_A)
  Key_B = PRF(master_secret_B)
  Key = Key_A ⊕ Key_B  (XOR of shares)
```

**MPC Decryption:**
1. Prover and Verifier jointly compute decryption
2. Each holds share of plaintext
3. Prover gets full plaintext (needs to interact with server)
4. Verifier learns nothing about plaintext

### Commitment Scheme

**Goal:** Prover commits to transcript without revealing it

#### Merkle Tree Commitments

```
         Root
        /    \
       H1    H2
      / \    / \
    H3  H4  H5 H6
    |   |   |   |
   D1  D2  D3  D4  ← Transcript chunks

Prover commits to Root
Later: Reveal D2 with proof [H1, H6]
```

**Properties:**
- ✅ Binding: Cannot change committed data
- ✅ Hiding: Root reveals nothing about data
- ✅ Selective: Reveal individual chunks
- ✅ Efficient: Log(n) proof size

#### Encoder Seed Commitment

```
encoder_seed = random()
commitment = Hash(encoder_seed)

Later, to reveal byte range [i, j]:
  - Reveal encoder_seed
  - Prove: Hash(encoder_seed) = commitment
  - Verifier decodes bytes [i, j]
```

### Session Header Structure

**What the Notary signs:**

```rust
struct SessionHeader {
    // Encoder commitment
    encoder_seed_commitment: Hash,
    
    // Merkle root of transcript
    merkle_root: Hash,
    
    // Transcript lengths
    sent_len: usize,
    recv_len: usize,
    
    // Handshake summary
    handshake_summary: HandshakeSummary,
}

struct HandshakeSummary {
    time: u64,
    server_ephemeral_key: PublicKey,
    handshake_commitment: Hash,
}
```

**Critical:** Notary signs WITHOUT seeing:
- Plaintext transcript
- Server identity (only key, not domain)
- Request/response content

### Presentation Structure

**What Prover shares with application verifier:**

```rust
struct Presentation {
    // Signed session header from notary
    session_header: SessionHeader,
    notary_signature: Signature,
    
    // Server identity proof
    server_name: String,
    server_cert_chain: Vec<Certificate>,
    
    // Opened commitments
    openings: Openings,
    
    // Revealed transcript portions
    transcript: PartialTranscript,
}

struct PartialTranscript {
    sent: Vec<Range>,      // [(start, end, data)]
    recv: Vec<Range>,
    
    // Merkle proofs for each range
    proofs: Vec<MerkleProof>,
}
```

### Verification Steps

**Application verifier checks:**

1. **Notary signature:**
   ```
   verify_signature(
     session_header,
     notary_signature,
     trusted_notary_pubkey
   ) == valid
   ```

2. **Certificate chain:**
   ```
   verify_cert_chain(
     server_cert_chain,
     server_ephemeral_key,
     trusted_root_CAs
   ) == valid
   
   extract_server_name(server_cert_chain[0]) == claimed_server_name
   ```

3. **Merkle proofs:**
   ```
   For each revealed range:
     recompute_merkle_root(range_data, merkle_proof) == session_header.merkle_root
   ```

4. **Encoder commitment:**
   ```
   Hash(encoder_seed) == session_header.encoder_seed_commitment
   ```

5. **Transcript integrity:**
   ```
   decode(encoder_seed, revealed_ranges) == transcript_data
   ```

## Cryptographic Primitives

### Supported Algorithms

**Signature Schemes:**
- `secp256k1` (Ethereum-compatible)
- `secp256r1` (NIST P-256)
- `ed25519` (EdDSA)

**Hash Functions:**
- `SHA-256` (commitments, Merkle trees)
- `BLAKE3` (fast hashing)

**Symmetric Encryption:**
- `AES-128-GCM`
- `AES-256-GCM`
- `ChaCha20-Poly1305`

**MPC Protocols:**
- Garbled circuits (two-party computation)
- Oblivious transfer (OT)
- QuickSilver (ZK commitments)

### Security Parameters

**Commitment Security:**
- Hash function: 256-bit (collision resistance)
- Merkle tree depth: Up to 32 levels
- Encoder seed: 256-bit random

**TLS Security:**
- TLS 1.2 with ECDHE key exchange
- Forward secrecy (ephemeral keys)
- Certificate pinning supported

**MPC Security:**
- Malicious security (not just semi-honest)
- Simulation-based proof
- Constant-round protocols

## Performance Characteristics

### Bandwidth Analysis

**MPC Overhead (2025 protocol):**

```
Fixed cost per session:     ~25 MB
Per KB sent (request):      ~10 MB
Per KB received (response): ~40 KB

Examples:
- 100 byte request + 500 byte response:  ~25 + 1 + 0.02 = ~26 MB
- 1 KB request + 10 KB response:         ~25 + 10 + 0.4 = ~35 MB
- 1 KB request + 100 KB response:        ~25 + 10 + 4 = ~39 MB
```

**Why so high?**
- Garbled circuits are bandwidth-intensive
- Each bit requires multiple ciphertexts
- Security proofs add overhead
- Future optimizations planned

### Latency Breakdown

**Typical Session:**

```
Component                    Time
────────────────────────────────────
MPC Setup                    500ms
TLS Handshake (with MPC)    1000ms
Request encryption           200ms
Response decryption          500ms
Commitment generation        300ms
Notary signing               100ms
────────────────────────────────────
Total                       ~2600ms
```

**Compared to normal HTTPS:**
- Standard TLS: ~100-200ms
- TLS Notary: ~2600ms (13x slower)

**Factors:**
- Network latency between Prover/Verifier
- MPC computation (CPU-bound)
- Bandwidth (garbled circuit transfer)

### Proof Size

**Presentation Size:**

```
Component                     Size
─────────────────────────────────────
Session header                 200 B
Notary signature               64 B
Server cert chain            2-5 KB
Merkle proofs             ~32B * log(n)
Revealed transcript        (variable)
Encoder seed                   32 B
─────────────────────────────────────
Minimum (small data)         ~5 KB
Typical (1KB revealed)      ~10 KB
Large (100KB revealed)     ~110 KB
```

## Implementation Details

### Rust Crate Structure

```
tlsn/
├── tlsn-core           # Core protocol
│   ├── commitment/     # Commitment schemes
│   ├── presentation/   # Presentation format
│   └── proof/          # Proof structures
├── tlsn-prover         # Prover implementation
│   ├── mpc/            # MPC protocols
│   └── state/          # State management
├── tlsn-verifier       # Verifier implementation
│   ├── cert/           # Certificate validation
│   └── merkle/         # Merkle proof validation
└── tlsn-common         # Shared utilities
```

### Key Types

```rust
// Core proof structure
pub struct Presentation {
    pub version: Version,
    pub session_header: SessionHeader,
    pub signature: Signature,
    pub server_name: ServerName,
    pub session: Session,
}

// Verification output
pub struct VerificationOutput {
    pub server_name: String,
    pub time: u64,
    pub sent_transcript: Vec<u8>,
    pub recv_transcript: Vec<u8>,
    pub notary_pubkey: Vec<u8>,
}

// Verification function
pub fn verify(
    presentation: &Presentation,
    provider: &CryptoProvider
) -> Result<VerificationOutput, Error>
```

### Browser Integration (tlsn-js)

**JavaScript API:**

```javascript
import { Prover } from 'tlsn-js'

// Create prover
const prover = new Prover({
  notaryUrl: 'wss://notary.tlsnotary.org',
  websocketProxyUrl: 'ws://localhost:55688'
})

// Connect to notary
await prover.connect()

// Make notarized request
const presentation = await prover.notarize('https://api.example.com/data', {
  method: 'GET',
  headers: { 'Accept': 'application/json' },
  
  // Redaction config
  redact: {
    requestHeaders: ['Authorization'],
    responseBody: ['ssn', 'creditCard']
  }
})

// Save presentation
await fs.writeFile('proof.json', JSON.stringify(presentation))
```

### WASM Compilation

**Compile to WASM:**

```bash
# Install target
rustup target add wasm32-unknown-unknown

# Build with optimizations
cargo build --target wasm32-unknown-unknown --release \
  --no-default-features \
  --features wasm

# Generate bindings
wasm-bindgen target/wasm32-unknown-unknown/release/tlsn_verifier.wasm \
  --out-dir pkg \
  --target nodejs

# Optimize WASM
wasm-opt -Oz pkg/tlsn_verifier_bg.wasm -o pkg/tlsn_verifier_bg.wasm
```

**Size optimization:**

```toml
[profile.release]
opt-level = "z"        # Optimize for size
lto = true             # Link-time optimization
codegen-units = 1      # Better optimization
panic = "abort"        # Smaller panic handler
strip = true           # Remove debug symbols
```

**Typical sizes:**
- Unoptimized: ~5 MB
- Optimized: ~1 MB
- Compressed (gzip): ~300 KB

## Integration Patterns

### Pattern 1: Direct Verification

```
User                  Loom
 │                     │
 │──── Proof ─────────►│
 │                     │
 │                     ├─ Verify signature
 │                     ├─ Check certificates
 │                     ├─ Validate Merkle proofs
 │                     │
 │◄── Verified Data ───│
```

### Pattern 2: Notary Service

```
User              Notary           Loom
 │                  │               │
 │──── Connect ────►│               │
 │                  │               │
 │◄─── MPC-TLS ────►│               │
 │                  │               │
 │◄─── Signed ──────│               │
 │   Attestation    │               │
 │                  │               │
 │──────── Present to Loom ────────►│
                                    │
                         Verify attestation
```

### Pattern 3: Multi-Notary

```
User          Notary 1    Notary 2    Notary 3
 │               │           │           │
 ├──── MPC ─────►│           │           │
 │◄─── Sign ─────┤           │           │
 │               │           │           │
 ├──── MPC ──────────────────►│           │
 │◄─── Sign ──────────────────┤           │
 │               │           │           │
 ├──── MPC ──────────────────────────────►│
 │◄─── Sign ──────────────────────────────┤
 │               │           │           │
 └────────── Aggregate proofs ────────────►
                           Verify all signatures
```

## Troubleshooting

### Common Errors

**"Signature verification failed"**
- Notary public key mismatch
- Presentation tampered with
- Wrong signature algorithm

**"Certificate chain invalid"**
- Server certificate expired
- CA not in trusted root store
- Certificate revoked

**"Merkle proof validation failed"**
- Transcript data modified
- Wrong Merkle tree structure
- Proof path incorrect

**"Commitment opening invalid"**
- Encoder seed mismatch
- Hash collision (extremely rare)
- Data encoding error

### Debug Logging

**Enable detailed logs:**

```bash
# Rust
RUST_LOG=trace,yamux=info cargo run --release

# TypeScript
DEBUG=tlsnotary:* node app.js
```

## Security Considerations

### Threat Model

**Assumptions:**
- ✅ Notary is trusted OR multiple notaries don't collude
- ✅ TLS certificates are valid
- ✅ Certificate authorities are trusted
- ✅ Cryptographic primitives are secure

**Protections:**
- ✅ Malicious prover cannot forge data
- ✅ Malicious verifier learns nothing private
- ✅ Network adversary cannot tamper
- ✅ Replay attacks detectable (timestamps)

**Limitations:**
- ❌ Single notary can collude with prover
- ❌ Server can lie (TLS Notary proves "server said X", not "X is true")
- ❌ Timing analysis may leak information
- ❌ Quantum computers break signatures (post-quantum planned)

### Best Practices

**For Verifiers:**
1. Require multiple notaries for high-stakes
2. Whitelist trusted notary public keys
3. Check proof timestamps (reject old)
4. Maintain proof hash database (prevent replay)
5. Validate server names against whitelist

**For Provers:**
1. Use HTTPS for notary connection
2. Verify notary identity
3. Redact sensitive data before sharing
4. Store presentations securely
5. Rotate notaries regularly

## References

- **Protocol Paper:** [TLSNotary: Proof of Data Provenance](https://eprint.iacr.org/)
- **GitHub:** https://github.com/tlsnotary/tlsn
- **Documentation:** https://tlsnotary.org/docs/intro
- **Specification:** https://tlsnotary.org/docs/protocol
- **Discord:** https://discord.gg/9XwESXtcN7

## Changelog

**v0.1.0-alpha.13** (October 2024)
- Stable Presentation format
- QuickSilver ZK commitments
- Browser extension support
- tlsn-js library

**Upcoming (2025)**
- Bandwidth optimization (25MB → 5MB)
- TLS 1.3 support
- On-chain verification
- Richer ZK statements
