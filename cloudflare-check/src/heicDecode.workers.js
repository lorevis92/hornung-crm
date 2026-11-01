// HEIC decoding in Workers with the SAME library the app uses today
// (libheif-js, which heic-decode wraps), only loaded differently:
//
// heic-decode imports 'libheif-js/wasm-bundle', which embeds the wasm as
// bytes and compiles it at runtime. Workers refuse that — only wasm modules
// bundled at deploy time may be instantiated (the /heic-decode-as-is route
// shows the exact error). So the .wasm file is imported as a module
// (wrangler pre-compiles it) and handed to the Emscripten factory through
// instantiateWasm. heic-decode's own decoding logic (lib.js) is reused as is.
import libheifFactory from 'libheif-js/libheif-wasm/libheif.js'
import LIBHEIF_WASM from 'libheif-js/libheif-wasm/libheif.wasm'
import heicDecodeLib from 'heic-decode/lib.js'

let decoder
function getDecoder() {
  decoder ||= (async () => {
    // With nodejs_compat, process.versions.node exists, so the Emscripten
    // glue believes it runs on Node and reads __dirname (only to build a
    // path it never uses, since instantiateWasm is given). Workers have no
    // __dirname: give it a harmless one.
    globalThis.__dirname ??= '/'
    const libheif = libheifFactory({
      instantiateWasm(imports, callback) {
        const instance = new WebAssembly.Instance(LIBHEIF_WASM, imports)
        callback(instance, LIBHEIF_WASM)
        return instance.exports
      }
    })
    return heicDecodeLib(libheif)
  })()
  return decoder
}

export async function decodeHeic(bytes) {
  const { one } = await getDecoder()
  return one({ buffer: bytes })
}
