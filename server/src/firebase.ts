import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import type { Config } from './config.js';
import type { AppDeps } from './types.js';

export function createFirebaseDeps(firebase: Config['firebase']): AppDeps {
  const app = initializeApp({ credential: cert(firebase) });
  const db = getFirestore(app);

  return {
    auth: getAuth(app),
    messages: {
      async add(message) {
        const ref = await db.collection('messages').add({
          ...message,
          createdAt: FieldValue.serverTimestamp(),
        });
        return { id: ref.id };
      },
    },
  };
}
