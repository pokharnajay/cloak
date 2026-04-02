const Module = require('module')
// Check Module._cache for electron after loading starts
const orig = Module._load.bind(Module)
Module._load = function(request, parent, isMain) {
  if (request === 'electron') {
    console.log('_load called for electron, parent:', parent?.filename)
    try {
      const result = orig(request, parent, isMain)
      console.log('_load result type:', typeof result, 'ipcMain:', !!result?.ipcMain)
      return result
    } catch(e) {
      console.log('_load error:', e.message)
      throw e
    }
  }
  return orig(request, parent, isMain)
}
// Simple test - just load the electron module
const e = require('electron')
console.log('final electron type:', typeof e)
process.exit(0)
