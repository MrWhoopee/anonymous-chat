import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const validEnv = {
  FIREBASE_PROJECT_ID: 'anonymous-chat-4d8fd',
  FIREBASE_CLIENT_EMAIL: 'svc@anonymous-chat-4d8fd.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n',
};

describe('loadConfig', () => {
  it('reads firebase credentials and defaults port to 3000', () => {
    const config = loadConfig(validEnv);

    expect(config.port).toBe(3000);
    expect(config.firebase.projectId).toBe('anonymous-chat-4d8fd');
    expect(config.firebase.clientEmail).toBe(validEnv.FIREBASE_CLIENT_EMAIL);
  });

  it('converts escaped \\n in the private key into real newlines', () => {
    const config = loadConfig(validEnv);

    expect(config.firebase.privateKey).toBe(
      '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n',
    );
  });

  it('uses PORT when provided', () => {
    expect(loadConfig({ ...validEnv, PORT: '4000' }).port).toBe(4000);
  });

  it('throws listing every missing variable', () => {
    expect(() => loadConfig({ FIREBASE_PROJECT_ID: 'x' })).toThrow(
      'Missing required environment variables: FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY',
    );
  });

  it('throws on an invalid PORT', () => {
    expect(() => loadConfig({ ...validEnv, PORT: 'abc' })).toThrow('Invalid PORT: abc');
  });
});
