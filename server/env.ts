// Load `.env` before anything reads process.env. Imported first by index.ts.
import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.cwd(), '.env');
if (fs.existsSync(file) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(file);
}
