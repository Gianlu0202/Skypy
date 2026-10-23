import type { ReactNode } from 'react';
import { Logo } from '../components/Logo.tsx';
import { navigate } from '../lib/router.ts';

export function NoticePage(props: { icon?: ReactNode; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="notice-page">
      <header className="notice-nav">
        <button className="logo-btn" onClick={() => navigate('/')} aria-label="Skypy home">
          <Logo size={24} />
        </button>
      </header>
      <div className="notice-card">
        {props.icon && <div className="notice-icon">{props.icon}</div>}
        <h1>{props.title}</h1>
        {props.children}
        {props.actions && <div className="notice-actions">{props.actions}</div>}
      </div>
    </div>
  );
}

export function NotFound() {
  return (
    <NoticePage
      icon="?"
      title="We couldn’t find that page"
      actions={
        <button className="btn btn-primary" onClick={() => navigate('/')}>
          Go to Skypy home
        </button>
      }
    >
      <p>Check the link, or start a new meeting from the home page.</p>
    </NoticePage>
  );
}
