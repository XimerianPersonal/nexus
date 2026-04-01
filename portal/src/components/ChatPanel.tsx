import { useState, useRef, useEffect, useCallback, type FormEvent } from 'react';
import type { ChatEntry } from '../hooks/useSession';

interface ChatPanelProps {
  messages: ChatEntry[];
  onSend: (text: string) => void;
  disabled?: boolean;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ChatPanel({ messages, onSend, disabled }: ChatPanelProps) {
  const [text, setText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    // Only auto-scroll if user is near the bottom
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 80;
    if (isNearBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const trimmed = text.trim();
      if (!trimmed) return;
      onSend(trimmed);
      setText('');
    },
    [text, onSend],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Stop propagation so remote screen doesn't capture these
      e.stopPropagation();
    },
    [],
  );

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <span>Chat</span>
        <span style={{ fontSize: '11px', fontWeight: 400 }}>
          {messages.length} message{messages.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="chat-messages" ref={messagesContainerRef}>
        {messages.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: '13px',
              padding: '40px 0',
            }}
          >
            No messages yet
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`chat-message ${msg.sender === 'self' ? 'self' : 'peer'}`}
            >
              <div className="chat-bubble">{msg.text}</div>
              <span className="chat-time">{formatTime(msg.timestamp)}</span>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
      <form className="chat-input-area" onSubmit={handleSubmit}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? 'Not connected' : 'Type a message...'}
          disabled={disabled}
        />
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={disabled || !text.trim()}
        >
          Send
        </button>
      </form>
    </div>
  );
}
