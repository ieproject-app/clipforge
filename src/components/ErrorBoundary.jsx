import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Unhandled render error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          background: '#08090f',
          color: '#f3f4f6',
          fontFamily: "'Outfit', sans-serif",
          padding: '40px',
          textAlign: 'center',
          gap: '20px'
        }}>
          <div style={{ fontSize: '48px' }}>💥</div>
          <h1 style={{ fontSize: '24px', fontWeight: '700', margin: 0 }}>Something went wrong</h1>
          <p style={{ color: '#9ca3af', fontSize: '14px', maxWidth: '500px', lineHeight: '1.6' }}>
            An unexpected error occurred while rendering the application.
            Please try refreshing the page.
          </p>
          <pre style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            borderRadius: '8px',
            padding: '16px',
            fontSize: '12px',
            color: '#ef4444',
            maxWidth: '100%',
            overflow: 'auto',
            textAlign: 'left'
          }}>
            {this.state.error?.message || 'Unknown error'}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '12px 28px',
              borderRadius: '8px',
              border: 'none',
              background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
              color: '#fff',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
              fontFamily: "'Outfit', sans-serif"
            }}
          >
            🔄 Refresh Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
