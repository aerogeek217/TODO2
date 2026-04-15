import { Component, type ErrorInfo, type ReactNode } from 'react'
import styles from './ErrorBoundary.module.css'

interface Props {
  children: ReactNode
  /** Short label shown in the fallback, e.g. "Canvas" or "App". */
  scope?: string
  /** Optional custom fallback renderer. Receives error + reset callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface State {
  error: Error | null
}

/**
 * Class component is required here — React does not (yet) expose
 * componentDidCatch / getDerivedStateFromError as hooks. This is the one
 * documented exception to the "functional components only" convention.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface to console for diagnostics. The app has no telemetry backend.
    console.error('[ErrorBoundary]', this.props.scope ?? 'app', error, info.componentStack)
  }

  reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset)
      }
      return (
        <div className={styles.fallback} role="alert">
          <h2 className={styles.title}>
            {this.props.scope ? `${this.props.scope} failed to render` : 'Something went wrong'}
          </h2>
          <p className={styles.message}>
            An unexpected error occurred. Your data is safe on disk — try reloading.
          </p>
          <code className={styles.error}>{this.state.error.message}</code>
          <div className={styles.actions}>
            <button className={styles.button} onClick={this.reset}>Try again</button>
            <button className={styles.button} onClick={() => window.location.reload()}>Reload</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
