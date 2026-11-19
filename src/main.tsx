import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
  lineInfo: string;
  stack: string;
}

function extractLineInfo(stack?: string): string {
  if (!stack) return 'Satır bilgisi alınamadı';
  const match = stack.match(/:(\d+):(\d+)/);
  if (match) {
    return `Satır: ${match[1]}, Sütun: ${match[2]}`;
  }
  return 'Satır bilgisi alınamadı';
}

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = {
      hasError: false,
      message: '',
      lineInfo: '',
      stack: '',
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    const stack = error?.stack ? String(error.stack) : '';
    return {
      hasError: true,
      message: error?.message || 'Beklenmeyen bir React hatası oluştu.',
      lineInfo: extractLineInfo(stack),
      stack,
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const combinedStack = [error?.stack, info?.componentStack].filter(Boolean).join('\n');
    this.setState({
      lineInfo: extractLineInfo(error?.stack),
      stack: combinedStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
          <div
            role="alert"
            className="w-full max-w-lg rounded-2xl border-2 border-red-600 bg-red-50 p-5 text-red-900 shadow-2xl"
          >
            <h1 className="text-lg font-bold text-red-800">React Uygulama Hatası</h1>
            <p className="mt-2 text-sm font-semibold leading-relaxed break-words">
              {this.state.message}
            </p>
            <p className="mt-2 rounded-lg bg-red-100 px-3 py-2 font-mono text-xs font-semibold text-red-900">
              {this.state.lineInfo}
            </p>
            {this.state.stack && (
              <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-red-200 bg-white p-2.5 font-mono text-[11px] leading-relaxed text-red-900 whitespace-pre-wrap break-words">
                {this.state.stack}
              </pre>
            )}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 min-h-[44px] w-full rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-red-700"
            >
              Sayfayı Yenile
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

try {
  if (
    typeof window !== 'undefined' &&
    (window.location.protocol === 'http:' || window.location.protocol === 'https:')
  ) {
    if (!document.querySelector('link[rel="manifest"]')) {
      const manifestLink = document.createElement('link');
      manifestLink.rel = 'manifest';
      manifestLink.href = '/manifest.webmanifest';
      document.head.appendChild(manifestLink);
    }
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {
          // Service worker registration skipped if unavailable
        });
      });
    }
  }
} catch {
  // Ignore environment restrictions under file:// or content://
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  );
}
