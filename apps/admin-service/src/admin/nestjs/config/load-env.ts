import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

export function loadBackendEnv() {
  const envPaths = [resolve(process.cwd(), 'backend/.env'), resolve(process.cwd(), '.env')];

  for (const envPath of envPaths) {
    if (!existsSync(envPath)) {
      continue;
    }

    const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const separatorIndex = trimmed.indexOf('=');

      if (separatorIndex === -1) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');

      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}
