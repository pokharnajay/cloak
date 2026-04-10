import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(err: Error) {
    return { error: err.message }
  }

  componentDidCatch(err: Error) {
    // Route to main process for logging
    try { window.clui?.copyToClipboard?.('') } catch {} // ensure IPC is live
    console.error('Cloak UI crashed:', err)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 12,
          background: 'rgba(10,10,10,0.95)', color: '#ccc', fontFamily: 'monospace',
          fontSize: 12, padding: 24, textAlign: 'center',
        }}>
          <div style={{ fontSize: 14, color: '#E12D39', fontWeight: 600 }}>Cloak encountered an error</div>
          <div style={{ color: '#666', maxWidth: 320, wordBreak: 'break-word' }}>{this.state.error}</div>
          <button
            onClick={() => { this.setState({ error: null }) }}
            style={{
              marginTop: 8, padding: '6px 16px', borderRadius: 8, border: 'none',
              background: 'rgba(44,177,188,0.2)', color: '#2CB1BC', cursor: 'pointer', fontSize: 12,
            }}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
