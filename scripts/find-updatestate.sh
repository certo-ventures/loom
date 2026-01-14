#!/bin/bash
# Find all updateState calls that need migration

echo "=================================================="
echo "Finding updateState calls that need migration..."
echo "=================================================="
echo ""

# Search for old-style updateState calls
echo "🔍 Searching for old-style updateState({ ... }) calls:"
echo ""

# This will find calls like: this.updateState({ or this.updateState  ({
grep -rn "this\.updateState\s*(\s*{" \
  --include="*.ts" \
  --exclude-dir=node_modules \
  --exclude-dir=dist \
  --exclude-dir=build \
  . 2>/dev/null || echo "✅ No old-style calls found!"

echo ""
echo "=================================================="
echo "Migration needed for lines shown above"
echo "=================================================="
echo ""
echo "Change from:"
echo "  this.updateState({ key: value })"
echo ""
echo "To:"
echo "  this.updateState(draft => { draft.key = value })"
echo ""
