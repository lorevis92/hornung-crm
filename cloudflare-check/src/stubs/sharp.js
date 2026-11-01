// sharp cannot run on Workers (native libvips binary). The check worker
// aliases it to this stub so that the REST of the real api/ module graph can
// be imported and checked; the image path is covered by
// imageNormalize.workers.js instead, and probe-sharp/ shows the real failure.
export default function sharp() {
  throw new Error('sharp is not available on Cloudflare Workers')
}
