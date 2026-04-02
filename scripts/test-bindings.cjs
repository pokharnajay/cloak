// Look for electron internals
console.log('process keys:', Object.getOwnPropertyNames(process).filter(k => k.toLowerCase().includes('electron') || k.includes('Binding')))
// Try to get app from binding
try {
  const b = process._linkedBinding('electron_browser_app')
  console.log('app binding:', typeof b, Object.keys(b||{}).slice(0,5))
} catch(e) { console.log('app err:', e.message) }
try {
  const b = process._linkedBinding('electron_common_asar')
  console.log('asar binding:', typeof b)
} catch(e) { console.log('asar err:', e.message) }
// Try to find where electron loads itself from
const paths = require.resolve.paths?.('electron') || []
console.log('resolve paths:', paths.slice(0,3))
process.exit(0)
