import React, { useRef } from 'react';
import type { ChatMessage } from '../../domain/types.js';
import { ChatBubble } from './ChatBubble.js';
import { ScrollToBottom } from './ScrollToBottom.js';
import { useAutoScroll } from '../hooks/useAutoScroll.js';

interface ChatMessageListProps {
  messages: ChatMessage[];
}

export function ChatMessageList({ messages }: ChatMessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Derive a trigger that changes on every streaming chunk or new message
  const lastMsg = messages[messages.length - 1];
  const scrollTrigger = lastMsg?.isStreaming
    ? `${messages.length}-${lastMsg.content.length}`
    : messages.length;
  const { isAtBottom, scrollToBottom } = useAutoScroll(containerRef, scrollTrigger);

  const hasStreaming = messages.some((m) => m.isStreaming);

  if (messages.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: 0.4,
          padding: 24,
          textAlign: 'center',
        }}
      >
        <div>
          <p style={{ fontSize: '1.1em', marginBottom: 8 }}>ClaudeCodex Chat</p>
          <p style={{ fontSize: '0.85em' }}>Ask questions about your codebase, get explanations, or plan changes.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '12px 8px',
        position: 'relative',
      }}
    >
      {messages.map((msg) => (
        <ChatBubble key={msg.id} message={msg} />
      ))}
      <ScrollToBottom
        visible={!isAtBottom && hasStreaming}
        onClick={scrollToBottom}
      />
    </div>
  );
}
