import fs from 'fs';
import path from 'path';

const credentialsPath = new URL('../credentials.json', import.meta.url).pathname;

export function loadCredentials() {
  const raw = fs.readFileSync(credentialsPath);
  const { username, password } = JSON.parse(raw);
  if (!username || !password) throw new Error("Missing creds");
  return { username, password };
}