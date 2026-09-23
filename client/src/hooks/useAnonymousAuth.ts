import { onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth';
import { useCallback, useEffect, useState } from 'react';
import { auth } from '../lib/firebase';

export interface AnonymousAuthState {
  user: User | null;
  loading: boolean;
  error: Error | null;
  retry: () => void;
}

export function useAnonymousAuth(): AnonymousAuthState {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Firebase restores a persisted session first; only sign in when there is none.
    return onAuthStateChanged(auth, (current) => {
      if (current) {
        setUser(current);
        setError(null);
        setLoading(false);
        return;
      }
      setUser(null);
      signInAnonymously(auth).catch((err: unknown) => {
        setError(err instanceof Error ? err : new Error('Anonymous sign-in failed'));
        setLoading(false);
      });
    });
  }, [attempt]);

  const retry = useCallback(() => {
    setError(null);
    setLoading(true);
    setAttempt((n) => n + 1);
  }, []);

  return { user, loading, error, retry };
}
