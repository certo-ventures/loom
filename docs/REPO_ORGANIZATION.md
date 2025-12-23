# Repository Organization with Rust

## Recommended Structure

```
loom/
├── .github/
│   └── workflows/
│       ├── ci.yml                    # Updated: Build Rust + TypeScript
│       └── release.yml               # Updated: Package WASM binaries
│
├── rust/                             # 🆕 New: All Rust code here
│   ├── Cargo.toml                    # Workspace manifest
│   ├── Cargo.lock                    # Lock file (check into git)
│   │
│   ├── tlsn-verifier/                # TLS Notary verification
│   │   ├── Cargo.toml
│   │   ├── src/
│   │   │   └── lib.rs                # WASM exports
│   │   └── tests/
│   │       └── verify.rs
│   │
│   ├── risc-zero-verifier/           # RISC Zero verification
│   │   ├── Cargo.toml
│   │   ├── src/
│   │   │   └── lib.rs
│   │   └── tests/
│   │       └── verify.rs
│   │
│   └── risc-zero-guests/             # RISC Zero guest programs
│       ├── Cargo.toml
│       └── programs/
│           ├── dti-calculator/       # DTI calculation guest
│           │   ├── Cargo.toml
│           │   └── src/
│           │       └── main.rs
│           └── compliance-checker/   # Compliance guest
│               ├── Cargo.toml
│               └── src/
│                   └── main.rs
│
├── build/                            # Compiled outputs
│   ├── wasm/                         # 🆕 Compiled WASM modules
│   │   ├── tlsn-verifier/
│   │   │   ├── tlsn_verifier_bg.wasm      # Core WASM (500KB)
│   │   │   ├── tlsn_verifier.js           # JS glue code
│   │   │   └── tlsn_verifier.d.ts         # TypeScript types
│   │   └── risc-zero-verifier/
│   │       ├── risc_zero_verifier_bg.wasm
│   │       ├── risc_zero_verifier.js
│   │       └── risc_zero_verifier.d.ts
│   │
│   ├── counter-actor.wasm            # AssemblyScript WASM (6KB)
│   └── echo.wasm                     # AssemblyScript WASM (6KB)
│
├── src/                              # TypeScript source
│   ├── actor/
│   │   ├── wasm-actor-adapter.ts
│   │   └── tls-notary-adapter.ts     # 🆕 Wrapper for Rust WASM
│   ├── activities/
│   │   ├── wasm-executor.ts
│   │   └── tls-notary-executor.ts    # 🆕 TLS Notary specific
│   └── ...
│
├── examples/
│   ├── tls-notary-actor.ts           # Updated: Use real WASM
│   ├── loan-workflow-with-tls.ts
│   └── wasm/
│       └── counter-actor.ts          # AssemblyScript examples
│
├── docs/
│   ├── RUST_CONSEQUENCES.md
│   ├── TLS_NOTARY_INTEGRATION.md
│   └── REPO_ORGANIZATION.md          # This file
│
├── scripts/                          # Build automation
│   ├── setup-dev.sh                  # 🆕 Install Rust toolchain
│   ├── build-rust.sh                 # 🆕 Build all Rust modules
│   ├── build-wasm.sh                 # 🆕 Compile to WASM
│   └── check-rust.sh                 # 🆕 Cargo check + test
│
├── .gitignore                        # Updated: Rust targets
├── .dockerignore                     # Updated: Rust targets
├── Dockerfile                        # Updated: Multi-stage with Rust
├── package.json                      # Updated: Rust build scripts
├── tsconfig.json
└── README.md                         # Updated: Rust setup instructions
```

## Detailed Organization

### 1. Rust Workspace (`rust/`)

#### Workspace Manifest

```toml
# rust/Cargo.toml
[workspace]
resolver = "2"
members = [
    "tlsn-verifier",
    "risc-zero-verifier",
    "risc-zero-guests/programs/*",
]

[workspace.dependencies]
# Shared dependencies across all crates
tlsn = "0.7"
risc0-zkvm = "1.0"
wasm-bindgen = "0.2"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
thiserror = "1.0"

[profile.release]
# Optimize for small WASM size
opt-level = "z"           # Optimize for size
lto = true                # Link-time optimization
codegen-units = 1         # Better optimization
panic = "abort"           # Smaller binaries
strip = true              # Remove symbols
```

#### TLS Notary Verifier

```toml
# rust/tlsn-verifier/Cargo.toml
[package]
name = "tlsn-verifier"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]  # Create dynamic library for WASM

[dependencies]
tlsn = { workspace = true }
wasm-bindgen = { workspace = true }
serde = { workspace = true }
serde_json = { workspace = true }
thiserror = { workspace = true }

# WASM-specific dependencies
console_error_panic_hook = "0.1"  # Better panic messages in WASM
wee_alloc = "0.4"                 # Smaller allocator

[dev-dependencies]
wasm-bindgen-test = "0.3"
```

```rust
// rust/tlsn-verifier/src/lib.rs
use wasm_bindgen::prelude::*;

// Set up panic hook for better error messages
#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

// Use smaller allocator
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

#[wasm_bindgen]
pub fn verify_tls_notary_proof(proof_json: &str) -> Result<String, JsValue> {
    // Implementation
}
```

### 2. Build Outputs (`build/`)

#### What Goes Where

```
build/
├── wasm/                           # ✅ Check into git (optional)
│   ├── tlsn-verifier/
│   │   ├── tlsn_verifier_bg.wasm   # 500KB - Core WASM binary
│   │   ├── tlsn_verifier.js        # 10KB - JS glue code
│   │   └── tlsn_verifier.d.ts      # 5KB - TypeScript definitions
│   └── .gitkeep
│
├── *.wasm                          # AssemblyScript outputs
└── *.js                            # AssemblyScript JS files
```

#### Git Strategy Options

**Option A: Check in WASM (Recommended for now)**
```gitignore
# .gitignore

# Keep compiled WASM in git for easier development
# build/wasm/**/*.wasm

# Ignore Rust build artifacts
rust/target/
rust/**/target/
```

**Pros:**
- Developers don't need Rust installed immediately
- Faster onboarding
- CI builds can be optional

**Cons:**
- Binary files in git
- Need to remember to rebuild and commit

**Option B: Build WASM in CI**
```gitignore
# .gitignore

# Don't check in WASM
build/wasm/**/*.wasm
build/wasm/**/*.js

# Ignore Rust build artifacts
rust/target/
```

**Pros:**
- Clean git history
- Always fresh builds

**Cons:**
- Every developer needs Rust
- CI builds take longer
- Need artifact caching

**Recommendation:** Start with Option A, move to Option B in production

### 3. TypeScript Integration (`src/`)

#### Wrapper for WASM Modules

```typescript
// src/activities/tls-notary-executor.ts
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * TLS Notary Proof Executor
 * 
 * Loads the Rust-compiled WASM verifier and provides
 * a clean TypeScript interface.
 */
export class TlsNotaryExecutor {
  private wasmModule: WebAssembly.Module | null = null
  private wasmInstance: any = null
  
  /**
   * Initialize the WASM module
   */
  async initialize(): Promise<void> {
    if (this.wasmInstance) return
    
    // Load the compiled WASM
    const wasmPath = join(__dirname, '../../build/wasm/tlsn-verifier/tlsn_verifier_bg.wasm')
    const wasmBytes = readFileSync(wasmPath)
    
    // Compile and instantiate
    this.wasmModule = await WebAssembly.compile(wasmBytes)
    
    // Import the JS glue code
    const { init, verify_tls_notary_proof } = await import(
      '../../build/wasm/tlsn-verifier/tlsn_verifier.js'
    )
    
    // Initialize
    await init(this.wasmModule)
    
    this.wasmInstance = { verify_tls_notary_proof }
  }
  
  /**
   * Verify a TLS Notary proof
   * 
   * @param proof - TLS Notary presentation
   * @returns Verified data
   */
  async verify(proof: TlsNotaryProof): Promise<VerifiedData> {
    await this.initialize()
    
    const resultJson = this.wasmInstance.verify_tls_notary_proof(
      JSON.stringify(proof)
    )
    
    return JSON.parse(resultJson)
  }
}
```

#### Actor Adapter

```typescript
// src/actor/tls-notary-adapter.ts
import { TlsNotaryExecutor } from '../activities/tls-notary-executor'

/**
 * TLS Notary Actor
 * 
 * High-level actor that uses the Rust WASM verifier
 * under the hood. Team doesn't need to know about Rust.
 */
export class TlsNotaryActor implements Actor {
  private executor: TlsNotaryExecutor
  
  constructor(context: ActorContext) {
    this.executor = new TlsNotaryExecutor()
  }
  
  async execute(input: { action: string, proof?: any }): Promise<any> {
    if (input.action === 'verify') {
      return this.executor.verify(input.proof)
    }
    // ... other actions
  }
}
```

### 4. Build Scripts (`scripts/`)

#### Development Setup

```bash
#!/bin/bash
# scripts/setup-dev.sh

echo "🔧 Setting up Loom development environment"

# Check if Rust is installed
if ! command -v rustup &> /dev/null; then
    echo "📦 Installing Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
else
    echo "✅ Rust already installed"
fi

# Add wasm32 target
echo "📦 Adding wasm32-unknown-unknown target..."
rustup target add wasm32-unknown-unknown

# Install wasm-bindgen-cli
if ! command -v wasm-bindgen &> /dev/null; then
    echo "📦 Installing wasm-bindgen-cli..."
    cargo install wasm-bindgen-cli
else
    echo "✅ wasm-bindgen-cli already installed"
fi

# Install wasm-opt (optional, for optimization)
if ! command -v wasm-opt &> /dev/null; then
    echo "📦 Installing wasm-opt..."
    # macOS
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install binaryen
    # Linux
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        sudo apt-get install binaryen
    fi
else
    echo "✅ wasm-opt already installed"
fi

# Build Rust modules
echo "🔨 Building Rust modules..."
./scripts/build-rust.sh

echo "✅ Development environment ready!"
```

#### Build Rust Modules

```bash
#!/bin/bash
# scripts/build-rust.sh

set -e

echo "🔨 Building Rust WASM modules..."

cd rust

# Build TLS Notary verifier
echo "Building tlsn-verifier..."
cargo build \
  --package tlsn-verifier \
  --target wasm32-unknown-unknown \
  --release

# Generate JS bindings
wasm-bindgen \
  target/wasm32-unknown-unknown/release/tlsn_verifier.wasm \
  --out-dir ../build/wasm/tlsn-verifier \
  --target nodejs

# Optimize with wasm-opt (optional)
if command -v wasm-opt &> /dev/null; then
  echo "Optimizing WASM..."
  wasm-opt \
    ../build/wasm/tlsn-verifier/tlsn_verifier_bg.wasm \
    -O3 \
    -o ../build/wasm/tlsn-verifier/tlsn_verifier_bg.wasm
fi

# Build RISC Zero verifier (similar)
# ...

cd ..

echo "✅ Rust build complete"
echo "📊 WASM sizes:"
du -h build/wasm/**/*.wasm
```

### 5. Package.json Integration

```json
{
  "name": "loom",
  "version": "0.1.0",
  "scripts": {
    "setup": "scripts/setup-dev.sh",
    
    "build:rust": "scripts/build-rust.sh",
    "build:ts": "tsc",
    "build": "npm run build:rust && npm run build:ts",
    
    "dev": "tsx watch src/index.ts",
    
    "test:rust": "cd rust && cargo test",
    "test:ts": "vitest run",
    "test": "npm run test:rust && npm run test:ts",
    
    "check:rust": "scripts/check-rust.sh",
    "check:ts": "tsc --noEmit",
    "check": "npm run check:rust && npm run check:ts",
    
    "clean": "rm -rf build dist rust/target"
  }
}
```

### 6. CI/CD Configuration

```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      # Setup Node.js
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
          cache: 'npm'
      
      # Setup Rust
      - uses: actions-rs/toolchain@v1
        with:
          toolchain: stable
          target: wasm32-unknown-unknown
          components: rustfmt, clippy
      
      # Cache Rust dependencies
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: rust -> target
      
      # Install wasm-bindgen-cli
      - uses: jetli/wasm-bindgen-action@v0.2.0
      
      # Install Node dependencies
      - run: npm ci
      
      # Build Rust WASM modules
      - run: npm run build:rust
      
      # Build TypeScript
      - run: npm run build:ts
      
      # Run tests
      - run: npm run test:rust
      - run: npm run test:ts
      
      # Upload WASM artifacts
      - uses: actions/upload-artifact@v3
        with:
          name: wasm-modules
          path: build/wasm/
```

### 7. Docker Configuration

```dockerfile
# Dockerfile
FROM rust:1.75 AS rust-builder

WORKDIR /app

# Copy Rust workspace
COPY rust/ ./rust/

# Build Rust modules
WORKDIR /app/rust
RUN rustup target add wasm32-unknown-unknown && \
    cargo install wasm-bindgen-cli && \
    cargo build --release --target wasm32-unknown-unknown

# Generate JS bindings
RUN wasm-bindgen \
    target/wasm32-unknown-unknown/release/tlsn_verifier.wasm \
    --out-dir /app/build/wasm/tlsn-verifier \
    --target nodejs

# Node.js stage
FROM node:20-alpine AS node-builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source and WASM from rust-builder
COPY src/ ./src/
COPY tsconfig.json ./
COPY --from=rust-builder /app/build/wasm/ ./build/wasm/

# Build TypeScript
RUN npm run build:ts

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy built artifacts
COPY --from=node-builder /app/dist/ ./dist/
COPY --from=node-builder /app/build/ ./build/
COPY --from=node-builder /app/node_modules/ ./node_modules/
COPY package*.json ./

# Run
CMD ["node", "dist/index.js"]
```

## File Size Reference

```
Typical Sizes:
├── rust/target/                    # 1-2 GB (gitignored)
├── rust/Cargo.lock                 # 50-100 KB (checked in)
├── build/wasm/tlsn-verifier/
│   ├── *.wasm                      # 500 KB (optional check-in)
│   ├── *.js                        # 10 KB (optional check-in)
│   └── *.d.ts                      # 5 KB (optional check-in)
└── build/wasm/risc-zero-verifier/
    └── *.wasm                      # 1-2 MB (optional check-in)
```

## Migration Path

### Phase 1: Setup (Day 1)

```bash
# Create structure
mkdir -p rust
mkdir -p build/wasm
mkdir -p scripts

# Create Rust workspace
cat > rust/Cargo.toml << 'EOF'
[workspace]
members = []
EOF

# Add setup script
# Create scripts/setup-dev.sh

# Update package.json
npm pkg set scripts.setup="./scripts/setup-dev.sh"
npm pkg set scripts.build:rust="./scripts/build-rust.sh"
```

### Phase 2: First Module (Day 2-3)

```bash
# Create TLS Notary verifier
cd rust
cargo new tlsn-verifier --lib

# Add to workspace
# Edit rust/Cargo.toml

# Add dependencies
# Edit rust/tlsn-verifier/Cargo.toml

# Implement verifier
# Edit rust/tlsn-verifier/src/lib.rs

# Build
cd ..
./scripts/build-rust.sh
```

### Phase 3: TypeScript Integration (Day 4-5)

```bash
# Create wrapper
# src/activities/tls-notary-executor.ts

# Update actor
# examples/tls-notary-actor.ts

# Test
npm test
```

## Best Practices

### 1. **Separation of Concerns**
- Rust: Cryptography only
- AssemblyScript: Business logic
- TypeScript: Orchestration

### 2. **Clear Boundaries**
- Rust exports simple JSON interfaces
- TypeScript doesn't see Rust internals
- WASM loading is hidden

### 3. **Documentation**
- Document each Rust crate's purpose
- Clear README in rust/ directory
- Examples of WASM usage

### 4. **Testing Strategy**
```
rust/*/tests/        # Rust unit tests
src/tests/           # TypeScript integration tests
examples/            # End-to-end examples
```

### 5. **Version Management**
- Lock Rust dependencies (Cargo.lock in git)
- Lock Node dependencies (package-lock.json in git)
- Tag releases with both versions

---

**Recommended Approach:**
- ✅ Keep Rust isolated in `rust/` directory
- ✅ Check in compiled WASM initially (easy onboarding)
- ✅ Hide Rust complexity behind TypeScript wrappers
- ✅ Multi-stage Docker builds for production
- ✅ Automated scripts for common tasks