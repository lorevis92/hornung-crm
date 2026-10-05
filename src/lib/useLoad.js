import { useCallback, useEffect, useRef, useState } from 'react'
import { runLoad } from './loadState'

// The one way a page loads its data. `load` is the page's own async
// function (wrapped in useCallback): it fetches and puts the results into
// the page's state, and may simply throw — the hook turns that into
// status 'error' instead of an endless spinner. A new `load` (its
// dependencies changed) reloads automatically.
//
// load(isCurrent): isCurrent() turns false once a newer load has started or
//   the page has unmounted, so a slow, stale response can skip writing its
//   results over fresher ones.
//
// Returns { status, error, reload, refresh }:
//   reload()  — from scratch, with the spinner (the "Riprova" button);
//   refresh() — in the background, keeping the page on screen (after an
//               action that changed the data, e.g. a re-extraction).
// delay: milliseconds to wait before loading (debounces a search box).
// keepOnChange: once loaded, a dependency change reloads in the background
//   instead of going back to the spinner (a filter or search box).
export function useLoad(load, { delay = 0, keepOnChange = false } = {}) {
  const [state, setState] = useState({ status: 'loading', error: null })
  const runId = useRef(0)
  const loadedOnce = useRef(false)

  const run = useCallback(
    (quiet = false) => {
      const id = ++runId.current
      const isCurrent = () => id === runId.current
      return runLoad(
        () => load(isCurrent),
        (next) => {
          if (!isCurrent()) return
          if (quiet && next.status === 'loading') return
          if (next.status === 'ready') loadedOnce.current = true
          setState(next)
        }
      )
    },
    [load]
  )

  useEffect(() => {
    const quiet = keepOnChange && loadedOnce.current
    if (!delay) {
      run(quiet)
      return () => {
        runId.current++
      }
    }
    const timer = setTimeout(() => run(quiet), delay)
    return () => {
      clearTimeout(timer)
      runId.current++
    }
  }, [run, delay, keepOnChange])

  const reload = useCallback(() => run(false), [run])
  const refresh = useCallback(() => run(true), [run])
  return { ...state, reload, refresh }
}
