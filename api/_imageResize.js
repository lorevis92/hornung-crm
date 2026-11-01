// Lanczos3 downscaling in plain JavaScript, written for the Workers memory
// limit (128 MB per isolate) rather than for speed.
//
// Why not @jsquash/resize (the wasm build of Squoosh's resizer): it copies
// the whole decoded image into its own wasm heap and allocates the output
// there too, and a wasm heap never shrinks — after one 12 MP photo the
// isolate would keep ~70 MB reserved for good. Here the source pixels are
// read where the decoder left them, and only the output plus a few
// intermediate rows are ever allocated:
//
//   horizontal pass, one source row at a time -> a small ring of rows
//   vertical pass, one output row at a time   <- that ring
//
// Same kernel as sharp's default (lanczos3, support 3 widened by the scale
// factor when reducing), applied in sRGB like sharp (no linear-light step).

function sinc(x) {
  if (x === 0) return 1
  const px = Math.PI * x
  return Math.sin(px) / px
}

function lanczos3(x) {
  return x > -3 && x < 3 ? sinc(x) * sinc(x / 3) : 0
}

// For every output index: the first source index and the normalized
// weights of the source samples that contribute to it.
function contributions(inSize, outSize) {
  const scale = inSize / outSize
  const filterScale = Math.max(1, scale)
  const support = 3 * filterScale
  const list = new Array(outSize)
  let maxTaps = 0
  for (let o = 0; o < outSize; o++) {
    const center = (o + 0.5) * scale - 0.5
    const start = Math.max(0, Math.ceil(center - support))
    const end = Math.min(inSize - 1, Math.floor(center + support))
    const weights = new Float32Array(end - start + 1)
    let sum = 0
    for (let i = start; i <= end; i++) {
      const w = lanczos3((i - center) / filterScale)
      weights[i - start] = w
      sum += w
    }
    if (sum !== 0) for (let k = 0; k < weights.length; k++) weights[k] /= sum
    list[o] = { start, weights }
    if (weights.length > maxTaps) maxTaps = weights.length
  }
  return { list, maxTaps }
}

/**
 * RGBA pixels (alpha ignored: images are flattened on white first) ->
 * a new RGBA image of outWidth x outHeight, alpha 255.
 */
export function resizeLanczos3({ data, width, height }, outWidth, outHeight) {
  const columns = contributions(width, outWidth)
  const rows = contributions(height, outHeight)
  const ringSize = rows.maxTaps + 1
  const ring = Array.from({ length: ringSize }, () => new Float32Array(outWidth * 3))
  const ringRow = new Int32Array(ringSize).fill(-1)

  const horizontal = (y) => {
    const slot = y % ringSize
    if (ringRow[slot] === y) return ring[slot]
    const line = ring[slot]
    const base = y * width * 4
    for (let x = 0; x < outWidth; x++) {
      const { start, weights } = columns.list[x]
      let r = 0
      let g = 0
      let b = 0
      let p = base + start * 4
      for (let k = 0; k < weights.length; k++, p += 4) {
        const w = weights[k]
        r += data[p] * w
        g += data[p + 1] * w
        b += data[p + 2] * w
      }
      line[x * 3] = r
      line[x * 3 + 1] = g
      line[x * 3 + 2] = b
    }
    ringRow[slot] = y
    return line
  }

  const out = new Uint8ClampedArray(outWidth * outHeight * 4)
  const acc = new Float32Array(outWidth * 3)
  for (let y = 0; y < outHeight; y++) {
    const { start, weights } = rows.list[y]
    acc.fill(0)
    for (let k = 0; k < weights.length; k++) {
      const line = horizontal(start + k)
      const w = weights[k]
      for (let i = 0; i < acc.length; i++) acc[i] += line[i] * w
    }
    let q = y * outWidth * 4
    for (let i = 0; i < acc.length; i += 3, q += 4) {
      // Uint8ClampedArray rounds half to even and clamps to 0..255.
      out[q] = acc[i]
      out[q + 1] = acc[i + 1]
      out[q + 2] = acc[i + 2]
      out[q + 3] = 255
    }
  }
  return { data: out, width: outWidth, height: outHeight }
}
