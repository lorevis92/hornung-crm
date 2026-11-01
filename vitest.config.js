// The tests run the real server code (api/), which imports its .wasm codecs
// the way Cloudflare Workers requires: as pre-compiled WebAssembly.Module
// default exports (wrangler bundles them so). Node can't import a .wasm
// that way on its own; this plugin gives the tests exactly what the Worker
// gets.
import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.js'

function wasmAsModule() {
  return {
    name: 'wasm-as-webassembly-module',
    enforce: 'pre',
    load(id) {
      const file = id.split('?')[0]
      if (!file.endsWith('.wasm')) return null
      return `import { readFileSync } from 'node:fs'\nexport default new WebAssembly.Module(readFileSync(${JSON.stringify(file)}))`
    }
  }
}

export default mergeConfig(
  viteConfig,
  defineConfig({
    plugins: [wasmAsModule()],
    // Through vite (and the plugin above), never straight to Node's loader.
    test: { server: { deps: { inline: [/\.wasm$/] } } }
  })
)
