import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    server: 'src/server.ts',
    index: 'src/index.ts',
    'scripts/quick-demo': 'scripts/quick-demo.ts',
    demo: 'demo.ts'
  },
  format: ['esm'],
  target: 'node18',
  clean: true,
  sourcemap: true,
  splitting: false,
  bundle: true,
  shims: true,
  external: [
    // Don't bundle node_modules that have native bindings
    'bcrypt',
    'pg-native',
    'bufferutil',
    'utf-8-validate'
  ]
})
