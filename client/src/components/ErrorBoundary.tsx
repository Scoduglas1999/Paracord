import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  retryCount: number;
}

const MAX_AUTO_RETRIES = 2;

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, retryCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    if (import.meta.env.DEV) {
      console.error('ErrorBoundary caught:', error, errorInfo);
    }
  }

  handleRetry = () => {
    this.setState((prev) => ({
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: prev.retryCount + 1,
    }));
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const isDev = import.meta.env.DEV;
      const canRetry = this.state.retryCount < MAX_AUTO_RETRIES;

      return (
        <div style={{
          padding: '2rem',
          color: 'var(--text-primary)',
          backgroundColor: 'var(--bg-primary)',
          minHeight: '100vh',
          fontFamily: 'monospace',
        }}>
          <h1 style={{ color: 'var(--accent-danger)', marginBottom: '1rem' }}>Something went wrong</h1>

          {isDev && this.state.error && (
            <details open style={{ marginBottom: '1rem' }}>
              <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                Error Details
              </summary>
              <pre style={{
                backgroundColor: 'var(--bg-secondary)',
                padding: '1rem',
                borderRadius: '8px',
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                border: '1px solid var(--border-subtle)',
              }}>
                {this.state.error.toString()}
                {'\n\n'}
                {this.state.errorInfo?.componentStack}
              </pre>
            </details>
          )}

          {!isDev && (
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              An unexpected error occurred. Try retrying below, or reload the app.
              If this keeps happening, check logs on the server and client.
            </p>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            {canRetry && (
              <button
                onClick={this.handleRetry}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: 'var(--accent-primary)',
                  color: '#fff',
                  border: '1px solid color-mix(in srgb, var(--accent-primary) 78%, var(--text-primary) 22%)',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Retry ({MAX_AUTO_RETRIES - this.state.retryCount} left)
              </button>
            )}
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: canRetry ? 'var(--bg-secondary)' : 'var(--accent-primary)',
                color: canRetry ? 'var(--text-primary)' : '#fff',
                border: '1px solid var(--border-subtle)',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
