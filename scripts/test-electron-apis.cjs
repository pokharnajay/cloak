// Test various ways to get electron APIs in Electron 35
const Module = require('module')

// Check if electron is in the built-in list
console.log('builtinModules includes electron:', Module.builtinModules.includes('electron'))

// Try process binding
try {
  const app = process._linkedBinding?.('electron_browser_app')
  console.log('linkedBinding app:', typeof app)
} catch(e) {
  console.log('linkedBinding error:', e.message)
}

// Check if require with special key works
try {
  // Temporarily disable our patch
  const orig = Module._resolveFilename
  Module._resolveFilename = orig
  // Try NativeModule
  const NativeModule = process.binding?.('natives')
  console.log('natives binding:', typeof NativeModule, NativeModule ? Object.keys(NativeModule).filter(k => k.includes('electron')).slice(0,5) : [])
} catch(e) {
  console.log('natives error:', e.message)
}

process.exit(0)
