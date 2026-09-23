import type { Message } from '../types';

interface MessageItemProps {
  message: Message;
  currentUid: string;
}

function formatTime(date: Date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function MessageItem({ message, currentUid }: MessageItemProps) {
  const isOwn = message.uid === currentUid;

  return (
    <li className={isOwn ? 'message message--own' : 'message'}>
      <div className="message__meta">
        <span className="message__author" title={message.uid}>
          {isOwn ? 'You' : message.uid}
        </span>
        {message.createdAt && (
          <time className="message__time" dateTime={message.createdAt.toISOString()}>
            {formatTime(message.createdAt)}
          </time>
        )}
      </div>
      <p className="message__text">{message.text}</p>
    </li>
  );
}
