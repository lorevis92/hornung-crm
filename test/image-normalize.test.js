// Uploaded images are converted to a reasonably sized JPEG before anything
// reads them (api/_imageNormalize.js, called first thing in runExtraction):
//  - an iPhone photo (HEIC) used to be accepted on upload and then fail the
//    extraction with "Unsupported mime type for AI extraction";
//  - a phone photo of several MB is resized/compressed instead of being
//    stored at camera resolution.
// test/fixtures/sample.heic is the public example image of the libheif
// project (github.com/strukturag/libheif, examples/example.heic), a real
// HEVC-coded HEIC like an iPhone produces.
import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import {
  IMAGE_MAX_BYTES_UNTOUCHED,
  IMAGE_MAX_SIDE,
  isImageUpload,
  jpegFileName,
  normalizeImageBuffer
} from '../api/_imageNormalize.js'

const heic = readFileSync(new URL('./fixtures/sample.heic', import.meta.url))

describe('converting an image', () => {
  it('turns an iPhone HEIC into a JPEG the extraction can read', async () => {
    const out = await normalizeImageBuffer(heic, { mimeType: 'image/heic', fileName: 'IMG_0042.HEIC' })
    expect(out.changed).toBe(true)
    expect(out.mimeType).toBe('image/jpeg')
    const meta = await sharp(out.buffer).metadata()
    expect(meta.format).toBe('jpeg')
    expect([meta.width, meta.height]).toEqual([out.width, out.height])
  })

  it('recognises a HEIC the browser sent without a type, by its extension', () => {
    expect(isImageUpload('', 'IMG_0042.heic')).toBe(true)
    expect(isImageUpload('application/octet-stream', 'scan.HEIF')).toBe(true)
    expect(isImageUpload('application/pdf', 'scan.pdf')).toBe(false)
    expect(isImageUpload('text/plain', 'note.txt')).toBe(false)
  })

  it('resizes and compresses a large phone photo of a document', async () => {
    // A 4032×5376 photo of a printed page (12+ lines of figures, paper
    // texture), saved at high quality like a phone camera does.
    const W = 4032
    const H = 5376
    const lines = Array.from(
      { length: 120 },
      (_, i) =>
        `<text x="200" y="${300 + i * 40}" font-size="30" font-family="Arial">Riga ${i} — Saldo al 31.12.2025 CHF 12'400.50</text>`
    ).join('')
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#f4f1ea"/>${lines}</svg>`
    )
    const texture = await sharp({ create: { width: W, height: H, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 12 } } })
      .png()
      .toBuffer()
    const photo = await sharp(svg).composite([{ input: texture, blend: 'soft-light' }]).jpeg({ quality: 97 }).toBuffer()
    expect(photo.length).toBeGreaterThan(3 * 1024 * 1024)

    const out = await normalizeImageBuffer(photo, { mimeType: 'image/jpeg', fileName: 'scan.jpg' })
    expect(out.changed).toBe(true)
    expect(Math.max(out.width, out.height)).toBe(IMAGE_MAX_SIDE)
    // Proportions kept.
    expect(out.width / out.height).toBeCloseTo(W / H, 2)
    // Well under the size threshold, and a fraction of the original.
    expect(out.buffer.length).toBeLessThan(IMAGE_MAX_BYTES_UNTOUCHED)
    expect(out.buffer.length).toBeLessThan(photo.length / 4)
  }, 30000)

  it('leaves a JPEG that is already small enough exactly as it is', async () => {
    const small = await sharp({ create: { width: 1200, height: 1600, channels: 3, background: '#ffffff' } }).jpeg().toBuffer()
    const out = await normalizeImageBuffer(small, { mimeType: 'image/jpeg', fileName: 'ok.jpg' })
    expect(out.changed).toBe(false)
    expect(out.buffer).toBe(small)
  })

  it('never enlarges a small image, and gives a transparent PNG a white background', async () => {
    const png = await sharp({ create: { width: 300, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toBuffer()
    const out = await normalizeImageBuffer(png, { mimeType: 'image/png', fileName: 'screenshot.png' })
    expect([out.width, out.height]).toEqual([300, 200])
    const { data } = await sharp(out.buffer).raw().toBuffer({ resolveWithObject: true })
    expect([data[0], data[1], data[2]].every((v) => v > 245)).toBe(true)
  })

  it('names the converted file .jpg', () => {
    expect(jpegFileName('IMG_0042.HEIC')).toBe('IMG_0042.jpg')
    expect(jpegFileName('client/2025/client_upload/ab12-scan.png')).toBe('client/2025/client_upload/ab12-scan.jpg')
    expect(jpegFileName('scan.jpg')).toBe('scan.jpg')
  })
})

// ---------------------------------------------------------------------------
// The whole extraction of an uploaded HEIC, with Storage, the database and
// the AI replaced by recorders.
// ---------------------------------------------------------------------------
function makeAdmin(documentRow, storedFile) {
  const state = {
    document: { ...documentRow },
    caseDocument: { id: documentRow.source_case_document_id, storage_path: documentRow.storage_path },
    storage: new Map([[documentRow.storage_path, storedFile]]),
    removed: []
  }
  const result = (data) => ({ data, error: null })
  const chain = (onDone) => {
    const c = {
      eq: () => c,
      in: () => c,
      order: () => c,
      select: () => c,
      maybeSingle: async () => onDone(true),
      then: (resolve, reject) => Promise.resolve(onDone(false)).then(resolve, reject)
    }
    return c
  }
  const admin = {
    state,
    from(table) {
      if (table === 'client_documents') {
        return {
          update(patch) {
            return chain(() => {
              Object.assign(state.document, patch)
              return result({ ...state.document })
            })
          }
        }
      }
      if (table === 'case_documents') {
        return {
          update(patch) {
            return chain(() => {
              Object.assign(state.caseDocument, patch)
              return result(null)
            })
          }
        }
      }
      if (table === 'extracted_document_fields') {
        return {
          upsert: async () => result(null),
          select: () => ({ eq: async () => result([]) }),
          delete: () => ({ in: async () => result(null) })
        }
      }
      if (table === 'document_other_findings') {
        return { delete: () => ({ eq: async () => result(null) }), insert: async () => result(null) }
      }
      const rows = {
        ai_model_settings: null,
        category_field_definitions: [{ field_key: 'gross_salary', field_label: 'Gross salary', value_type: 'numeric' }],
        client_persons: [{ person_type: 'primary', first_name: 'Sara', last_name: 'Bianchi' }],
        client_children: []
      }[table]
      if (rows === undefined) throw new Error(`unexpected table: ${table}`)
      return { select: () => chain(() => result(rows)) }
    },
    storage: {
      from: () => ({
        async download(path) {
          const buffer = state.storage.get(path)
          return result({ arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) })
        },
        async upload(path, buffer, options) {
          state.storage.set(path, buffer)
          state.uploadedType = options.contentType
          return result(null)
        },
        async remove(paths) {
          for (const p of paths) state.storage.delete(p)
          state.removed.push(...paths)
          return result(null)
        }
      })
    }
  }
  return admin
}

describe('extracting an uploaded iPhone photo', () => {
  let runExtraction
  beforeAll(async () => {
    vi.resetModules()
    vi.doMock('../api/_registrySync.js', () => ({ syncRegistryForClientYear: async () => {} }))
    ;({ runExtraction } = await import('../api/extract-document.js'))
  })
  afterAll(() => vi.doUnmock('../api/_registrySync.js'))

  it('converts it, stores the JPEG in place of the original, and extracts it', async () => {
    const admin = makeAdmin(
      {
        id: 'doc-1',
        client_id: 'client-1',
        tax_year: 2025,
        status: 'uploaded',
        mime_type: 'image/heic',
        file_name: 'IMG_0042.HEIC',
        storage_path: 'hornung/client-1/2025/client_upload/ab12-IMG_0042.HEIC',
        source_case_document_id: 'case-doc-1'
      },
      heic
    )
    const create = vi.fn(async ({ max_tokens: maxTokens }) => ({
      content: [{ type: 'text', text: maxTokens === 2000 ? '[]' : '{"document_person": {"ref": "taxpayer"}, "fields": [], "other_findings": []}' }]
    }))

    const result = await runExtraction(admin, { messages: { create } }, 'doc-1', {
      forcedCategoryCode: 'salary_statement'
    })

    // Extracted — no "Unsupported mime type".
    expect(result).toEqual({ claimed: true, documentId: 'doc-1' })
    expect(admin.state.document.status).toBe('extracted')
    expect(admin.state.document.extraction_error).toBeNull()

    // The model was shown a JPEG.
    const imageBlock = create.mock.calls[0][0].messages[0].content.find((b) => b.type === 'image')
    expect(imageBlock.source.media_type).toBe('image/jpeg')

    // The JPEG replaced the original in Storage, and both rows point at it.
    const newPath = 'hornung/client-1/2025/client_upload/ab12-IMG_0042.jpg'
    expect(admin.state.uploadedType).toBe('image/jpeg')
    expect([...admin.state.storage.keys()]).toEqual([newPath])
    expect(admin.state.removed).toEqual(['hornung/client-1/2025/client_upload/ab12-IMG_0042.HEIC'])
    for (const row of [admin.state.document, admin.state.caseDocument]) {
      expect(row).toMatchObject({ storage_path: newPath, mime_type: 'image/jpeg', file_name: 'IMG_0042.jpg' })
    }
    expect((await sharp(admin.state.storage.get(newPath)).metadata()).format).toBe('jpeg')
  }, 30000)

  it('leaves a PDF completely alone', async () => {
    const pdf = Buffer.from('%PDF-1.4 fake')
    const admin = makeAdmin(
      {
        id: 'doc-2',
        client_id: 'client-1',
        tax_year: 2025,
        status: 'uploaded',
        mime_type: 'application/pdf',
        file_name: 'salario.pdf',
        storage_path: 'hornung/client-1/2025/client_upload/cd34-salario.pdf',
        source_case_document_id: 'case-doc-2'
      },
      pdf
    )
    const create = vi.fn(async () => ({ content: [{ type: 'text', text: '{"fields": [], "other_findings": []}' }] }))
    await runExtraction(admin, { messages: { create } }, 'doc-2', { forcedCategoryCode: 'salary_statement' })
    expect(admin.state.uploadedType).toBeUndefined()
    expect(admin.state.removed).toEqual([])
    expect(admin.state.document.storage_path).toBe('hornung/client-1/2025/client_upload/cd34-salario.pdf')
    expect(create.mock.calls[0][0].messages[0].content[0].type).toBe('document')
  })
})
