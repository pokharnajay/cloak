const Module = require('module')
// Patch _resolveFilename to throw for 'electron' (mimicking no npm package)
const orig = Module._resolveFilename.bind(Module)
Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === 'electron') {
    // Throw as if module not found - force Electron's internal handling
    const err = new Error("Cannot find module 'electron'")
    err.code = 'MODULE_NOT_FOUND'
    throw err
  }
  return orig(request, parent, isMain, options)
}
try {
  const e = require('electron')
  console.log('type:', typeof e, 'has ipcMain:', !!e?.ipcMain)
} catch(e) {
  console.log('error:', e.message)
}
process.exit(0)
