import { Fragment, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { MessageSquare, SendHorizontal } from 'lucide-react';
import { LIMITS, type ChatMessage } from '../../../shared/protocol.ts';
import { avatarColor, formatClock } from '../lib/format.ts';
import type { Meeting } from '../lib/meeting.ts';
import { useStore } from '../lib/store.ts';

const URL_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g;

function linkify(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    out.push(
      <a key={i} href={m[0]} target="_blank" rel="noopener noreferrer">
        {m[0]}
      </a>,
    );
    last = i + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function ChatPanel({ meeting }: { meeting: Meeting }) {
  const chat = useStore((s) => s.chat);
  const sessionId = useStore((s) => s.sessionId);
  const signal = useStore((s) => s.signal);
  const [text, setText] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    useStore.setState({ unread: 0 });
    input.current?.focus();
  }, []);

  useLayoutEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat.length]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const value = text.trim();
    if (!value) return;
    if (meeting.send({ t: 'chat', text: value.slice(0, LIMITS.chatLength) })) {
      setText('');
      stick.current = true;
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="panel chat">
      <div
        className="panel-scroll chat-list"
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        aria-live="polite"
      >
        {chat.length === 0 ? (
          <div className="chat-empty">
            <MessageSquare size={28} />
            <p>Messages are visible to everyone in the meeting and disappear when the meeting ends.</p>
          </div>
        ) : (
          chat.map((m, i) => <Message key={m.id} msg={m} prev={chat[i - 1]} mine={m.sessionId === sessionId} />)
        )}
      </div>
      <form className="chat-compose" onSubmit={submit}>
        <textarea
          ref={input}
          value={text}
          rows={1}
          maxLength={LIMITS.chatLength}
          placeholder={signal === 'open' ? 'Message everyone' : 'Reconnecting…'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          aria-label="Message everyone"
        />
        <button type="submit" className="chat-send" disabled={!text.trim() || signal !== 'open'} aria-label="Send">
          <SendHorizontal size={18} />
        </button>
      </form>
    </div>
  );
}

function Message({ msg, prev, mine }: { msg: ChatMessage; prev?: ChatMessage; mine: boolean }) {
  const grouped = prev && prev.memberId === msg.memberId && msg.ts - prev.ts < 120_000;
  return (
    <div className={`msg${grouped ? ' grouped' : ''}${mine ? ' mine' : ''}`}>
      {!grouped && (
        <div className="msg-head">
          <span className="msg-name" style={{ color: mine ? undefined : avatarColor(msg.memberId) }}>
            {mine ? 'You' : msg.name}
          </span>
          <span className="msg-time">{formatClock(msg.ts)}</span>
        </div>
      )}
      <div className="msg-text">
        {msg.text.split('\n').map((line, i) => (
          <Fragment key={i}>
            {i > 0 && <br />}
            {linkify(line)}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
