import { useRef, useState, type FormEvent } from 'react';

const MAX_LENGTH = 500;

interface MessageInputProps {
  onSend: (text: string) => Promise<void>;
}

export function MessageInput({ onSend }: MessageInputProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // State updates are async; the ref blocks a second submit fired before re-render.
  const sendingRef = useRef(false);

  const trimmed = text.trim();
  const canSend = trimmed.length > 0 && trimmed.length <= MAX_LENGTH && !sending;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSend || sendingRef.current) return;

    sendingRef.current = true;
    setSending(true);
    setError(null);
    try {
      await onSend(trimmed);
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  return (
    <form className="message-input" onSubmit={handleSubmit}>
      <input
        aria-label="Message"
        placeholder="Type a message…"
        value={text}
        maxLength={MAX_LENGTH}
        onChange={(event) => setText(event.target.value)}
        autoComplete="off"
      />
      <span className="message-input__counter">
        {text.length}/{MAX_LENGTH}
      </span>
      <button type="submit" disabled={!canSend}>
        Send
      </button>
      {error && (
        <p className="message-input__error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
