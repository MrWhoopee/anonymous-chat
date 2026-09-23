import { useEffect, useRef } from 'react';
import type { Message } from '../types';
import { MessageItem } from './MessageItem';

interface MessageListProps {
  messages: Message[];
  currentUid: string;
}

export function MessageList({ messages, currentUid }: MessageListProps) {
  const endRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    // scrollIntoView is missing in jsdom, hence the optional call
    endRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return <p className="message-list__empty">No messages yet. Say hi!</p>;
  }

  return (
    <ul className="message-list">
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} currentUid={currentUid} />
      ))}
      <li ref={endRef} aria-hidden="true" />
    </ul>
  );
}
