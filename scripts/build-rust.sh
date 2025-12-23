#!/bin/bash
# Build Rust WASM modules for Loom

set -e

echo "🔨 Building Rust WASM modules..."
echo ""

# Check if Rust is installed
if ! command -v cargo &> /dev/null; then
    echo "❌ Rust not found. Run './scripts/setup-dev.sh' first"
    exit 1
fi

# Check if wasm-bindgen is installed
if ! command -v wasm-bindgen &> /dev/null; then
    echo "❌ wasm-bindgen-cli not found. Run './scripts/setup-dev.sh' first"
    exit 1
fi

# Navigate to Rust workspace
cd rust

# Build all workspace members
echo "📦 Building workspace (this may take a few minutes on first run)..."
cargo build \
  --target wasm32-unknown-unknown \
  --release

echo "✅ Rust compilation complete"
echo ""

# Generate JS bindings for tlsn-verifier
echo "🔧 Generating JS bindings for tlsn-verifier..."

# Create output directory
mkdir -p ../build/wasm/tlsn-verifier

# Run wasm-bindgen
wasm-bindgen \
  target/wasm32-unknown-unknown/release/tlsn_verifier.wasm \
  --out-dir ../build/wasm/tlsn-verifier \
  --target nodejs \
  --typescript

echo "✅ JS bindings generated"
echo ""

# Optimize with wasm-opt if available
if command -v wasm-opt &> /dev/null; then
  echo "⚡ Optimizing WASM with wasm-opt..."
  
  wasm-opt \
    ../build/wasm/tlsn-verifier/tlsn_verifier_bg.wasm \
    -O3 \
    --enable-bulk-memory \
    --enable-sign-ext \
    -o ../build/wasm/tlsn-verifier/tlsn_verifier_bg.wasm
  
  echo "✅ WASM optimized"
else
  echo "ℹ️  wasm-opt not found, skipping optimization (install binaryen for smaller WASM)"
fi

cd ..

echo ""
echo "📊 WASM module sizes:"
du -h build/wasm/**/*.wasm 2>/dev/null || echo "  (no WASM files found)"

echo ""
echo "✅ Rust build complete!"
echo ""
echo "Generated files:"
echo "  • build/wasm/tlsn-verifier/tlsn_verifier_bg.wasm"
echo "  • build/wasm/tlsn-verifier/tlsn_verifier.js"
echo "  • build/wasm/tlsn-verifier/tlsn_verifier.d.ts"
