import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../lib/firebase';
import { MESSAGE_LIMIT, toMessage } from '../lib/messages';
import type { Message } from '../types';

export function useMessages(enabled: boolean): { messages: Message[]; error: Error | null } {
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // Security Rules require auth, so subscribe only after sign-in.
    if (!enabled) return;

    const latest = query(collection(db, 'messages'), orderBy('createdAt', 'desc'), limit(MESSAGE_LIMIT));
    return onSnapshot(
      latest,
      (snapshot) => {
        // Newest-first from the query; show oldest at the top.
        setMessages(snapshot.docs.map((doc) => toMessage(doc.id, doc.data())).reverse());
        setError(null);
      },
      (err) => setError(err),
    );
  }, [enabled]);

  return { messages, error };
}
