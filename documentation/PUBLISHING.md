# Publishing Guide for Internal Teams

## Setup (One-time)

### Option 1: GitHub Packages

1. **Create GitHub Personal Access Token**
   - Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
   - Create token with `write:packages` and `read:packages` permissions
   - Save token securely

2. **Configure npm**
   ```bash
   # Create or edit ~/.npmrc
   echo "@your-org:registry=https://npm.pkg.github.com" >> ~/.npmrc
   echo "//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN" >> ~/.npmrc
   ```

3. **Update package.json**
   - Already configured with `@your-org/loom` scope
   - `publishConfig` points to GitHub Packages

### Option 2: Azure Artifacts (if using Azure DevOps)

1. **Create Azure Artifacts feed**
   - Create a new feed in Azure DevOps

2. **Configure npm**
   ```bash
   npm config set @your-org:registry https://pkgs.dev.azure.com/your-org/_packaging/your-feed/npm/registry/
   ```

3. **Update package.json**
   ```json
   "publishConfig": {
     "registry": "https://pkgs.dev.azure.com/your-org/_packaging/your-feed/npm/registry/"
   }
   ```

### Option 3: Local npm Registry (Verdaccio)

For completely internal/air-gapped environments:

```bash
# Install Verdaccio
npm install -g verdaccio

# Run it
verdaccio

# Configure
npm config set registry http://localhost:4873/
```

## Publishing New Versions

### 1. Build the library

```bash
npm run build
```

This compiles TypeScript to `dist/` directory.

### 2. Version bump

```bash
# Patch (0.1.0 → 0.1.1)
npm version patch

# Minor (0.1.0 → 0.2.0)
npm version minor

# Major (0.1.0 → 1.0.0)
npm version major
```

### 3. Publish

```bash
npm publish
```

For GitHub Packages, this will publish to `https://npm.pkg.github.com/@your-org/loom`

### 4. Tag and push

```bash
git push --follow-tags
```

## CI/CD Automation (GitHub Actions)

Create `.github/workflows/publish.yml`:

```yaml
name: Publish Package

on:
  release:
    types: [created]

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    
    steps:
      - uses: actions/checkout@v3
      
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
          registry-url: 'https://npm.pkg.github.com'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build
        run: npm run build
      
      - name: Publish to GitHub Packages
        run: npm publish
        env:
          NODE_AUTH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
```

## Consuming the Library

Teams install with:

```bash
# First time setup (configure registry)
npm config set @your-org:registry https://npm.pkg.github.com

# Install
npm install @your-org/loom

# Or specific version
npm install @your-org/loom@0.2.0
```

## Development Workflow

### For library maintainers:

```bash
# Make changes
git checkout -b feature/new-executor

# Test locally in another project
cd /path/to/loom
npm link

cd /path/to/consumer-project
npm link @your-org/loom

# Test changes immediately
# ... make changes in loom ...
# ... see changes in consumer-project ...

# When ready, unlink
npm unlink @your-org/loom
cd /path/to/loom
npm unlink
```

### For library consumers during development:

```json
// consumer-project/package.json
{
  "dependencies": {
    "@your-org/loom": "file:../loom"  // Local path during development
  }
}
```

Then switch to published version:

```json
{
  "dependencies": {
    "@your-org/loom": "^0.2.0"  // Published version for production
  }
}
```

## Versioning Strategy

Follow Semantic Versioning:

- **MAJOR** (1.0.0): Breaking changes to public API
  - Removing exports
  - Changing function signatures
  - Renaming classes/interfaces
  
- **MINOR** (0.2.0): New features, backward compatible
  - Adding new executors
  - New optional parameters
  - New exports
  
- **PATCH** (0.1.1): Bug fixes, backward compatible
  - Fixing executor bugs
  - Documentation updates
  - Performance improvements

## What Gets Published

Files included (see `package.json` `files` field):
- `dist/` - Compiled JavaScript + TypeScript declarations
- `README.md`
- `LICENSE`

Files **NOT** included:
- `src/` - Source TypeScript
- `examples/` - Example code
- `tests/` - Test files
- `node_modules/`
- `.vscode/`, `.github/`

## Pre-publish Checklist

- [ ] All tests pass: `npm test`
- [ ] Build succeeds: `npm run build`
- [ ] TypeScript types generated: Check `dist/*.d.ts`
- [ ] Version bumped appropriately
- [ ] CHANGELOG.md updated
- [ ] README.md up to date
- [ ] No sensitive data in published files

## Troubleshooting

### "403 Forbidden" when publishing
- Check GitHub token has `write:packages` permission
- Verify you're member of the organization
- Check `publishConfig.registry` is correct

### "Cannot find module @your-org/loom"
- Consumer needs to configure registry: `npm config set @your-org:registry ...`
- Check authentication token is valid
- Verify package was published successfully

### Types not working
- Ensure `dist/` contains `.d.ts` files
- Check `package.json` `types` field points to correct file
- Try `npm install --force` in consumer project
