import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
describe('bill9206 local deployment preparation', () => {
  it('selects bill9206 while every emulator/test command explicitly uses demo-settle', () => {
    expect(read('.firebaserc').projects.default).toBe('bill9206');
    const scripts = read('package.json').scripts;
    for (const key of ['emulators', 'test:integration', 'test:e2e'])
      expect(scripts[key]).toContain('--project demo-settle');
  });
  it('retains static Hosting and the existing protected rules and indexes files', () => {
    const c = read('firebase.json');
    expect(c.firestore).toEqual({ rules: 'firestore.rules', indexes: 'firestore.indexes.json' });
    expect(c.hosting.public).toBe('dist');
    expect(c.hosting.rewrites).toEqual([{ source: '**', destination: '/index.html' }]);
    expect(c).not.toHaveProperty('functions');
    expect(c).not.toHaveProperty('apphosting');
    expect(c).not.toHaveProperty('extensions');
    expect(read('firestore.indexes.json')).toEqual({ indexes: [], fieldOverrides: [] });
  });
  it('permits Firebase Google OAuth frames without allowing framing of the app', () => {
    const headers = read('firebase.json').hosting.headers[0].headers as {
      key: string;
      value: string;
    }[];
    const csp = headers.find((h) => h.key === 'Content-Security-Policy')!.value;
    expect(csp).toContain("script-src 'self' https://apis.google.com");
    expect(csp).toContain(
      "frame-src 'self' https://bill9206.firebaseapp.com https://bill9206.web.app",
    );
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-eval');
    expect(headers).toContainEqual({ key: 'X-Frame-Options', value: 'DENY' });
  });
  it('documents precisely the four supported Firebase web config variables', () => {
    const env = readFileSync('.env.example', 'utf8');
    expect(env).toContain('VITE_FIREBASE_PROJECT_ID=bill9206');
    expect(env).toContain('VITE_FIREBASE_AUTH_DOMAIN=bill9206.firebaseapp.com');
    for (const variable of ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_APP_ID'])
      expect(env).toMatch(new RegExp('^' + variable + '=$', 'm'));
    expect(env).toContain('VITE_USE_EMULATORS=false');
    expect(readFileSync('.gitignore', 'utf8')).toContain('.env.*');
  });
});
