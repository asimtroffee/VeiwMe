import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('Unhandled Application Error:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.hash = '#/';
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            backgroundColor: 'var(--color-background)'
          }}
        >
          <div
            className="card"
            style={{
              maxWidth: '520px',
              width: '100%',
              textAlign: 'center',
              padding: '40px 32px'
            }}
          >
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: 'var(--radius-full)',
                backgroundColor: 'var(--color-error-container)',
                color: 'var(--color-on-error-container)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '20px'
              }}
            >
              <span className="material-symbols-outlined fill" style={{ fontSize: '32px' }}>
                warning
              </span>
            </div>
            <h2 className="headline-md" style={{ color: 'var(--color-on-surface)', marginBottom: '8px' }}>
              Something unexpected happened
            </h2>
            <p className="body-md" style={{ color: 'var(--color-on-surface-variant)', marginBottom: '24px' }}>
              The application encountered an unexpected state. Your booking data remains safe on the cloud.
            </p>

            {this.state.error && (
              <div
                style={{
                  backgroundColor: 'var(--color-surface-container)',
                  padding: '12px 16px',
                  borderRadius: 'var(--radius-md)',
                  textAlign: 'left',
                  fontSize: '12px',
                  fontFamily: 'monospace',
                  color: 'var(--color-on-surface-variant)',
                  marginBottom: '24px',
                  overflowX: 'auto'
                }}
              >
                {this.state.error.toString()}
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button type="button" className="btn btn-secondary" onClick={this.handleGoHome}>
                Go to Home
              </button>
              <button type="button" className="btn btn-primary" onClick={this.handleReload}>
                Reload Application
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
