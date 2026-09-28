import { Component } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

// A render error anywhere below this point (a missing import, a null
// dereference, ...) otherwise unmounts the ENTIRE page with no trace for
// the specialist beyond a blank screen — React 18 has no default fallback
// UI for an uncaught error during render. This is deliberately a class
// component: getDerivedStateFromError/componentDidCatch have no hook
// equivalent. Fallback copy is passed in already-translated (title/
// description) so this stays usable from anywhere without needing the
// i18n hook itself.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-sand/60 px-6 py-10 text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white text-amber-600 ring-1 ring-line">
            <AlertTriangle size={22} aria-hidden="true" />
          </span>
          <p className="font-medium text-ink-800">{this.props.title}</p>
          <p className="mt-1 max-w-sm text-[15px] text-ink-500">{this.props.description}</p>
          <p className="mt-2 max-w-md break-words text-[12.5px] text-ink-400">{this.state.error.message}</p>
          <button
            type="button"
            className="btn-secondary btn-sm mt-4"
            onClick={() => window.location.reload()}
          >
            <RefreshCw size={15} aria-hidden="true" />
            {this.props.retryLabel}
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
