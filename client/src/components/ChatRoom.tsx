import { useAnonymousAuth } from '../hooks/useAnonymousAuth';
import { useMessages } from '../hooks/useMessages';
import { sendMessage } from '../lib/api';
import { MessageInput } from './MessageInput';
import { MessageList } from './MessageList';
import { UserIdFooter } from './UserIdFooter';

export function ChatRoom() {
  const { user, loading, error, retry } = useAnonymousAuth();
  const { messages, error: messagesError } = useMessages(Boolean(user));

  if (loading) {
    return <p className="status">Connecting…</p>;
  }

  if (error || !user) {
    return (
      <div className="status">
        <p>Couldn't connect</p>
        <button type="button" onClick={retry}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <main className="chat">
      <header className="chat__header">
        <h1>Anonymous Chat</h1>
      </header>
      {messagesError && (
        <div className="banner" role="alert">
          Couldn't load messages
        </div>
      )}
      <MessageList messages={messages} currentUid={user.uid} />
      <MessageInput onSend={sendMessage} />
      <UserIdFooter uid={user.uid} />
    </main>
  );
}
