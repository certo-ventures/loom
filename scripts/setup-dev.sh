#!/bin/bash
# Setup Loom development environment with Rust

set -e

echo "🔧 Setting up Loom development environment"
echo ""

# Check if Rust is installed
if ! command -v rustup &> /dev/null; then
    echo "📦 Installing Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
    echo "✅ Rust installed"
else
    echo "✅ Rust already installed ($(rustc --version))"
fi

# Update Rust
echo "📦 Updating Rust..."
rustup update stable
echo ""

# Add wasm32 target
echo "📦 Adding wasm32-unknown-unknown target..."
rustup target add wasm32-unknown-unknown
echo "✅ WASM target added"
echo ""

# Install wasm-bindgen-cli
if ! command -v wasm-bindgen &> /dev/null; then
    echo "📦 Installing wasm-bindgen-cli..."
    cargo install wasm-bindgen-cli
    echo "✅ wasm-bindgen-cli installed"
else
    echo "✅ wasm-bindgen-cli already installed ($(wasm-bindgen --version))"
fi
echo ""

# Install wasm-opt (optional, for optimization)
if ! command -v wasm-opt &> /dev/null; then
    echo "📦 Installing wasm-opt (binaryen)..."
    
    # Detect OS
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        if command -v brew &> /dev/null; then
            brew install binaryen
            echo "✅ wasm-opt installed via Homebrew"
        else
            echo "⚠️  Homebrew not found. Install binaryen manually for WASM optimization"
        fi
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        if command -v apt-get &> /dev/null; then
            sudo apt-get update && sudo apt-get install -y binaryen
            echo "✅ wasm-opt installed via apt"
        elif command -v yum &> /dev/null; then
            sudo yum install -y binaryen
            echo "✅ wasm-opt installed via yum"
        else
            echo "⚠️  Package manager not detected. Install binaryen manually for WASM optimization"
        fi
    else
        echo "⚠️  OS not detected. Install binaryen manually for WASM optimization"
    fi
else
    echo "✅ wasm-opt already installed"
fi
echo ""

# Install Node dependencies
echo "📦 Installing Node dependencies..."
npm install
echo "✅ Node dependencies installed"
echo ""

# Build Rust modules
echo "🔨 Building Rust WASM modules..."
if [ -f "./scripts/build-rust.sh" ]; then
    ./scripts/build-rust.sh
else
    echo "⚠️  build-rust.sh not found, skipping Rust build"
fi

echo ""
echo "✅ Development environment ready!"
echo ""
echo "Next steps:"
echo "  1. Run 'npm run build:rust' to build Rust modules"
echo "  2. Run 'npm test' to verify everything works"
echo "  3. Run 'npm run example:tls-notary' to see TLS Notary in action"
