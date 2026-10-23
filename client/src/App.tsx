import { Component, type ReactNode } from 'react';
import { Home } from './pages/Home.tsx';
import { RoomPage } from './pages/RoomPage.tsx';
import { NotFound } from './pages/Notice.tsx';
import { roomIdFromPath, usePath } from './lib/router.ts';

export function App() {
  const path = usePath();
  const roomId = roomIdFromPath(path);
  return (
    <ErrorBoundary>
      {path === '/' ? <Home /> : roomId ? <RoomPage key={roomId} roomId={roomId} /> : <NotFound />}
    </ErrorBoundary>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[skypy] UI crashed', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="notice-page">
        <div className="notice-card">
          <div className="notice-icon">!</div>
          <h1>Something went wrong</h1>
          <p>Skypy hit an unexpected problem. Reloading usually fixes it — you’ll rejoin in the same seat.</p>
          <div className="notice-actions">
            <button className="btn btn-primary" onClick={() => location.reload()}>
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
