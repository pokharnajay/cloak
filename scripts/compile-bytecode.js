'use strict'
/**
 * Bytenode post-build script.
 * Compiles dist/main/index.js to V8 bytecode (dist/main/index.jsc).
 * Must be run with Electron for bytecode to match the app's V8 version:
 *   npx electron scripts/compile-bytecode.js
 *
 * The loader (dist/main/loader.js) is written automatically.
 * Set "main": "dist/main/loader.js" in package.json to use bytecode in production.
 */

const path = require('path')
const fs = require('fs')

const distMain = path.join(__dirname, '..', 'dist', 'main')
const sourceFile = path.join(distMain, 'index.js')
const outputFile = path.join(distMain, 'index.jsc')
const loaderFile = path.join(distMain, 'loader.js')

if (!fs.existsSync(sourceFile)) {
  console.error('dist/main/index.js not found. Run npm run build first.')
  process.exit(1)
}

try {
  const bytenode = require('bytenode')
  bytenode.compileFile({ filename: sourceFile, output: outputFile })
  console.log('Bytecode compiled:', outputFile)
} catch (err) {
  console.warn('bytenode compilation failed (run with Electron for correct V8 version):', err.message)
  console.warn('Skipping bytecode compilation — dist/main/index.js will be used as-is.')
  process.exit(0)
}

// Write the loader that loads bytecode at runtime
const loaderContent = `'use strict'
try { require('bytenode') } catch (_) {}
require('./index.jsc')
`
fs.writeFileSync(loaderFile, loaderContent)
console.log('Loader written:', loaderFile)
