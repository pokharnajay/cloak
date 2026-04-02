const Module = require('module')
// Force 'electron' to be treated as a built-in module
// so Node's resolution skips file-based lookup
if (!Module.builtinModules.includes('electron')) {
  Module.builtinModules.push('electron')
}
// Now require electron - it should go through Node's built-in pathway
const e = require('electron')
console.log('type:', typeof e, 'has ipcMain:', !!e?.ipcMain)
process.exit(0)
