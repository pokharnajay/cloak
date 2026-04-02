const Module = require('module')
console.log('cache keys with electron:', Object.keys(Module._cache).filter(k => k.includes('electron') || k === 'electron'))
console.log('first few cache keys:', Object.keys(Module._cache).slice(0, 5))
// Check if electron module can be loaded without file resolution
// by checking what's already loaded
const keys = Object.keys(require.cache || Module._cache)
console.log('require.cache electron keys:', keys.filter(k => k.includes('electron/index')).slice(0, 3))
process.exit(0)
