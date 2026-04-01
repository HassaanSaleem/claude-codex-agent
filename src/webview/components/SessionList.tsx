import React, { useState, useEffect } from 'react';
import type { ChatSession } from '../../domain/types.js';

interface SessionListProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSwitch: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
  onRename?: (sessionId: string, title: string) => void;
}

function relativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(isoDate).toLocaleDateString();
}

const AGENT_BADGES: Record<string, string> = {
  claude: 'C',
  codex: 'X',
  workflow: 'W',
};

export function SessionList({ sessions, activeSessionId, onSwitch, onDelete, onRename }: SessionListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const startRename = (session: ChatSession) => {
    setEditingId(session.id);
    setEditTitle(session.title);
  };

  const commitRename = () => {
    if (editingId && editTitle.trim() && onRename) {
      onRename(editingId, editTitle.trim());
    }
    setEditingId(null);
  };

  // Clear search when session count drops below threshold
  useEffect(() => {
    if (sessions.length <= 3 && searchQuery) {
      setSearchQuery('');
    }
  }, [sessions.length, searchQuery]);

  const filteredSessions = searchQuery.trim()
    ? sessions.filter((s) => s.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : sessions;

  if (sessions.length === 0) {
    return (
      <div style={{ padding: '8px 12px', fontSize: '0.8em', opacity: 0.5 }}>
        No previous sessions
      </div>
    );
  }

  return (
    <div
      style={{
        borderBottom: '1px solid var(--border)',
        maxHeight: 240,
        overflowY: 'auto',
      }}
    >
      {/* Search input (011-session-search) */}
      {sessions.length > 3 && (
        <div style={{ padding: '4px 8px' }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search sessions..."
            style={{
              width: '100%',
              padding: '3px 8px',
              fontSize: '0.78em',
              background: 'var(--input-bg)',
              color: 'var(--foreground)',
              border: '1px solid var(--border)',
              borderRadius: 3,
            }}
          />
        </div>
      )}
      {filteredSessions.length === 0 && searchQuery && (
        <div style={{ padding: '6px 12px', fontSize: '0.78em', opacity: 0.5 }}>
          No sessions match "{searchQuery}"
        </div>
      )}
      {filteredSessions.map((session) => {
        const isActive = session.id === activeSessionId;
        return (
          <div
            key={session.id}
            onClick={() => onSwitch(session.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 12px',
              cursor: 'pointer',
              background: isActive ? 'var(--hover-bg)' : 'transparent',
              borderLeft: isActive ? '2px solid var(--button-bg)' : '2px solid transparent',
              fontSize: '0.82em',
            }}
            onMouseEnter={(e) => {
              if (!isActive) e.currentTarget.style.background = 'var(--hover-bg)';
            }}
            onMouseLeave={(e) => {
              if (!isActive) e.currentTarget.style.background = 'transparent';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden', flex: 1 }}>
              <span
                title={session.agentType}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 18,
                  height: 18,
                  borderRadius: 3,
                  fontSize: '0.7em',
                  fontWeight: 700,
                  background: 'var(--button-bg)',
                  color: 'var(--button-fg)',
                  flexShrink: 0,
                }}
              >
                {AGENT_BADGES[session.agentType] ?? '?'}
              </span>
              {editingId === session.id ? (
                <input
                  autoFocus
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    background: 'var(--input-bg)',
                    color: 'var(--foreground)',
                    border: '1px solid var(--button-bg)',
                    borderRadius: 2,
                    padding: '1px 4px',
                    fontSize: 'inherit',
                    width: '100%',
                  }}
                />
              ) : (
                <span
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (onRename) startRename(session);
                  }}
                  title={session.title}
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontWeight: isActive ? 600 : 400,
                  }}
                >
                  {session.title}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 8 }}>
              <span style={{ fontSize: '0.75em', opacity: 0.5 }}>
                {relativeTime(session.createdAt)}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(session.id);
                }}
                title="Delete session"
                style={{
                  background: 'transparent',
                  color: 'var(--foreground)',
                  opacity: 0.4,
                  padding: '0 4px',
                  fontSize: '0.9em',
                  lineHeight: 1,
                  borderRadius: 2,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.4'; }}
              >
                ×
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
