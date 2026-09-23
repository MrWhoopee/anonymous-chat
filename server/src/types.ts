export interface TokenVerifier {
  verifyIdToken(token: string): Promise<{ uid: string }>;
}

export interface NewMessage {
  text: string;
  uid: string;
}

export interface MessageStore {
  add(message: NewMessage): Promise<{ id: string }>;
}

export interface AppDeps {
  auth: TokenVerifier;
  messages: MessageStore;
}
