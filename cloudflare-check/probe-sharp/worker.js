// Imports the app's REAL api/_imageNormalize.js (sharp + heic-decode) with
// nothing stubbed, to record exactly how sharp fails on Workers.
import { normalizeImageBuffer } from '../../api/_imageNormalize.js'

export default {
  async fetch(request) {
    try {
      const out = await normalizeImageBuffer(new Uint8Array(await request.arrayBuffer()), { mimeType: 'image/png', fileName: 'x.png' })
      return Response.json({ works: true, width: out.width })
    } catch (error) {
      return Response.json({ works: false, error: String(error?.message || error) })
    }
  }
}
