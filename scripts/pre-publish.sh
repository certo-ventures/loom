#!/bin/bash
set -e

echo "🔍 Pre-publish checks..."

# Check if on main branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  echo "⚠️  Warning: Not on main branch (currently on: $BRANCH)"
  read -p "Continue anyway? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# Check for uncommitted changes
if [[ -n $(git status -s) ]]; then
  echo "❌ Error: Uncommitted changes detected"
  git status -s
  exit 1
fi

# Run tests
echo "🧪 Running tests..."
npm test

# Type check
echo "🔍 Type checking..."
npm run check

# Clean build
echo "🧹 Cleaning old build..."
npm run clean

# Build
echo "🔨 Building..."
npm run build

# Check dist exists
if [ ! -d "dist" ]; then
  echo "❌ Error: dist/ directory not found after build"
  exit 1
fi

# Check for .d.ts files
if [ -z "$(find dist -name '*.d.ts')" ]; then
  echo "❌ Error: No TypeScript declaration files found in dist/"
  exit 1
fi

echo "✅ All checks passed!"
echo ""
echo "Ready to publish. Run:"
echo "  npm version [patch|minor|major]"
echo "  npm publish"
echo "  git push --follow-tags"
