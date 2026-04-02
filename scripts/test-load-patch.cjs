const Module = require('module')

// First: make _resolveFilename fail for 'electron' (no npm package scenario)
const origResolve = Module._resolveFilename.bind(Module)
Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === 'electron') {
    const err = new Error("Cannot find module 'electron'")
    err.code = 'MODULE_NOT_FOUND'
    err.requireStack = [parent?.filename || '']
    throw err
  }
  return origResolve(request, parent, isMain, options)
}

// Second: also patch _load to see what happens
const origLoad = Module._load.bind(Module)
Module._load = function(request, parent, isMain) {
  if (request === 'electron') {
    console.log('_load intercepted electron request')
    try {
      const result = origLoad(request, parent, isMain)
      console.log('_load success type:', typeof result, 'ipcMain:', !!result?.ipcMain)
      return result
    } catch(e) {
      console.log('_load caught error:', e.message)
      throw e
    }
  }
  return origLoad(request, parent, isMain)
}

try {
  const e = require('electron')
  console.log('final type:', typeof e, 'ipcMain:', !!e?.ipcMain)
} catch(e) {
  console.log('outer catch:', e.message)
}
process.exit(0)
