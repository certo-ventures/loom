import * as esbuild from 'esbuild'

await esbuild.build({
  entryPoints: [
    'src/server.ts',
    'src/index.ts', 
    'scripts/quick-demo.ts',
    'demo.ts'
  ],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outdir: 'dist',
  outExtension: { '.js': '.js' },
  sourcemap: true,
  external: ['bcrypt', 'pg-native', 'bufferutil', 'utf-8-validate'],
  banner: {
    js: "import { createRequire } from 'module';const require = createRequire(import.meta.url);"
  }
})

console.log('✓ Build complete')
