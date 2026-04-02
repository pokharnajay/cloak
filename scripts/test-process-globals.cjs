// Check if Electron exposes its APIs through process or global before requiring 'electron'
console.log('process.type:', process.type)
// In Electron main process, process.type should be 'browser'
const globalKeys = Object.getOwnPropertyNames(global).filter(k => 
  !['setTimeout','setInterval','clearTimeout','clearInterval','setImmediate','clearImmediate',
    'queueMicrotask','URL','URLSearchParams','TextEncoder','TextDecoder','AbortController',
    'AbortSignal','EventTarget','Event','MessageChannel','MessageEvent','MessagePort',
    'performance','crypto','fetch','Headers','Request','Response','FormData','Blob',
    'ReadableStream','WritableStream','TransformStream','CompressionStream','DecompressionStream',
    'CountQueuingStrategy','ByteLengthQueuingStrategy','console','process','global','Buffer',
    'require','__filename','__dirname','module','exports','Object','Function','Array',
    'String','Number','Boolean','Symbol','BigInt','Error','Promise'].includes(k)
)
console.log('extra global keys:', globalKeys.slice(0, 20))
process.exit(0)
