const Module = require('module')
// Check if there's ANYTHING in the cache at startup
const cacheKeys = Object.keys(Module._cache)
console.log('cache size at start:', cacheKeys.length)
console.log('all cache keys:', JSON.stringify(cacheKeys))
process.exit(0)
