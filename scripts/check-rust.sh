#!/bin/bash
# Check Rust code quality

set -e

echo "🔍 Checking Rust code quality..."
echo ""

cd rust

# Format check
echo "📝 Checking code formatting..."
cargo fmt --all -- --check
echo "✅ Formatting OK"
echo ""

# Clippy (linter)
echo "🔎 Running Clippy..."
cargo clippy --all-targets --all-features -- -D warnings
echo "✅ Clippy OK"
echo ""

# Tests
echo "🧪 Running tests..."
cargo test --all
echo "✅ Tests passed"
echo ""

# Build check
echo "🔨 Checking build..."
cargo check --all-targets
echo "✅ Build check OK"
echo ""

cd ..

echo "✅ All checks passed!"
