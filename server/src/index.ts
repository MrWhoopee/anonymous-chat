import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createFirebaseDeps } from './firebase.js';

try {
  process.loadEnvFile();
} catch {
  // No .env file (e.g. in Docker, where env comes from env_file) — use process.env as is.
}

try {
  const config = loadConfig();
  const app = buildApp(createFirebaseDeps(config.firebase), { logger: true });
  await app.listen({ port: config.port, host: '0.0.0.0' });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
