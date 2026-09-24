// POST /api/delete-client
//   { clientId } -> permanently deletes a client (staff only)
//
// This must run server-side with the service-role key because it needs to:
//   1. See app_profiles rows for OTHER apps (RLS normally scopes visibility to
//      app_id = 'hornung_crm' only), to decide whether the shared login is
//      still used elsewhere.
//   2. Call the Supabase Auth admin API to delete the user outright when it
//      isn't.
//
// Order matters: app_profiles.user_id references auth.users(id) ON DELETE
// CASCADE, so deleting auth.users first would silently wipe app_profiles rows
// for every app that person uses. We therefore always read the profile/user
// first, remove the clients row + this app's app_profiles row explicitly, and
// only THEN decide whether auth.users can go too.
import { APP_ID, httpError, readBody, requireStaff } from './_lib.js'

// src/lib/config.js can't be imported here (it's Vite-only, uses
// import.meta.env) — keep these in sync with that file.
const STORAGE_BUCKET = 'client-documents'
const STORAGE_ROOT = 'hornung'

// Supabase Storage's `.list()` only returns the immediate children of a path
// — "folders" come back as entries with `id: null` (there's no real folder
// row, just a shared path prefix among files). Recurses into every such
// entry to collect the full, flat list of actual file paths under `prefix`.
async function listAllStorageObjectPaths(admin, prefix) {
  const { data, error } = await admin.storage.from(STORAGE_BUCKET).list(prefix, { limit: 1000 })
  if (error) throw error
  const paths = []
  for (const item of data || []) {
    const itemPath = `${prefix}/${item.name}`
    if (item.id === null) {
      paths.push(...(await listAllStorageObjectPaths(admin, itemPath)))
    } else {
      paths.push(itemPath)
    }
  }
  return paths
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' })

  try {
    const { admin } = await requireStaff(req)
    const body = readBody(req)
    const clientId = body.clientId
    if (!clientId) throw httpError(400, 'CLIENT_ID_REQUIRED', 'A clientId is required.')

    const { data: client, error: clientError } = await admin
      .from('clients')
      .select('id, profile_id')
      .eq('id', clientId)
      .maybeSingle()
    if (clientError) throw httpError(400, 'CLIENT_LOOKUP_FAILED', clientError.message)
    if (!client) throw httpError(404, 'CLIENT_NOT_FOUND', 'Client not found.')

    let userId = null
    if (client.profile_id) {
      const { data: profileRow } = await admin
        .from('app_profiles')
        .select('user_id')
        .eq('id', client.profile_id)
        .maybeSingle()
      userId = profileRow?.user_id || null
    }

    try {
      const paths = await listAllStorageObjectPaths(admin, `${STORAGE_ROOT}/${clientId}`)
      if (paths.length) {
        const { error } = await admin.storage.from(STORAGE_BUCKET).remove(paths)
        if (error) throw error
      }
    } catch (err) {
      console.error('[delete-client] storage cleanup failed — files may remain orphaned', err)
    }

    const { error: deleteClientError } = await admin.from('clients').delete().eq('id', clientId)
    if (deleteClientError) throw httpError(400, 'DELETE_CLIENT_FAILED', deleteClientError.message)

    if (client.profile_id) {
      const { error: deleteProfileError } = await admin
        .from('app_profiles')
        .delete()
        .eq('id', client.profile_id)
      if (deleteProfileError) throw httpError(400, 'DELETE_PROFILE_FAILED', deleteProfileError.message)
    }

    let authUserDeleted = false
    if (userId) {
      const { data: otherProfiles } = await admin
        .from('app_profiles')
        .select('id')
        .eq('user_id', userId)
        .neq('app_id', APP_ID)
        .limit(1)

      if (!otherProfiles?.length) {
        const { error: deleteUserError } = await admin.auth.admin.deleteUser(userId)
        if (deleteUserError) throw httpError(400, 'DELETE_USER_FAILED', deleteUserError.message)
        authUserDeleted = true
      }
    }

    return res.status(200).json({ deleted: true, authUserDeleted })
  } catch (error) {
    console.error('[delete-client]', error)
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code })
  }
}
