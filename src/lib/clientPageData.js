// The client page's data (src/pages/SpecialistClient.jsx).
//
// The page shows what is already on file straight away; the registry
// catch-up (src/lib/recalc.js's catchUpRegistrySyncInBackground — one sync
// call per eligible document of every tax year) runs AFTER that, truly in
// the background. It used to be awaited before the page counted as loaded,
// so opening a client with several years of documents meant waiting for all
// those calls before anything appeared.
//
// loadClientPage resolves as soon as the client, its cases and its pending
// suggestions are read. The catch-up is started then and never awaited;
// when it finishes, onCatchUpDone() runs — only if isCurrent() still says
// the specialist is on this page (useLoad's isCurrent goes false on leaving
// or reloading). Its own errors are already handled inside the catch-up.
export async function loadClientPage({ api, clientId, catchUp, isCurrent = () => true, onCatchUpDone }) {
  const [client, cases, suggestions] = await Promise.all([
    api.getClient(clientId),
    api.listCases(clientId),
    api.listFieldSuggestions(clientId)
  ])
  Promise.resolve()
    .then(() => catchUp(clientId, cases))
    .then(() => {
      if (isCurrent()) return onCatchUpDone?.()
    })
    .catch((error) => console.error('[client page catch-up]', error))
  return { client, cases, suggestions }
}
