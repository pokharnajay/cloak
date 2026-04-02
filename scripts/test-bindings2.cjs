try {
  const b = process._linkedBinding('electron_browser_app')
  console.log('app binding type:', typeof b)
  if (b) console.log('app binding keys:', Object.getOwnPropertyNames(b).slice(0,10))
} catch(e) { console.log('binding error:', e.message) }

// The key: Electron usually sets global.__electron__
console.log('global electron:', typeof global.electron)

// Check if the module "electron" can be accessed via a different search path
// by temporarily removing the node_modules path from require cache
const nodePtyPath = require.resolve('node-pty')
console.log('node-pty resolves ok:', nodePtyPath.includes('node-pty'))
process.exit(0)
