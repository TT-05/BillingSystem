import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  linkWithCredential,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth';
import type { Auth } from 'firebase/auth';
import { connectFirestoreEmulator, doc, getDoc, getFirestore } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { initializeGoogleProfile } from '../src/services/googleAuth';
import { createLedger, saveProfile } from '../src/services/ledger';
let env: RulesTestEnvironment;
let app: FirebaseApp;
let auth: Auth;
let db: Firestore;
function credential(sub: string, email: string, name = 'Google Friend') {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  // Unsigned identity assertions are accepted ONLY by the explicitly connected emulator.
  const token =
    encode({ alg: 'none', typ: 'JWT' }) +
    '.' +
    encode({
      iss: 'https://accounts.google.com',
      aud: 'demo-settle',
      sub,
      email,
      email_verified: true,
      name,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }) +
    '.';
  return GoogleAuthProvider.credential(token);
}
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-settle',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
  app = initializeApp(
    { projectId: 'demo-settle', apiKey: 'demo-settle-key', appId: 'demo-settle-app' },
    'google-integration',
  );
  auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
});
beforeEach(async () => {
  await signOut(auth);
  await env.clearFirestore();
});
afterAll(async () => {
  await deleteApp(app);
  await env.cleanup();
});
describe('real Google provider flows against Auth and Firestore emulators', () => {
  it('creates a Google profile under its authenticated UID and preserves a customized name', async () => {
    const key = crypto.randomUUID();
    const result = await signInWithCredential(auth, credential(key, `${key}@example.com`));
    const uid = result.user.uid;
    await initializeGoogleProfile(db, result.user);
    const saved = await getDoc(doc(db, 'users', uid));
    expect(saved.data()?.name).toBe('Google Friend');
    expect(saved.data()?.updatedAt.toMillis()).toBeGreaterThan(0);
    await updateProfile(result.user, { displayName: 'Chosen app name' });
    await saveProfile(db, result.user);
    await updateProfile(result.user, { displayName: 'Provider refresh name' });
    await initializeGoogleProfile(db, result.user);
    expect(result.user.displayName).toBe('Chosen app name');
    expect(result.user.uid).toBe(uid);
  });
  it('links Google and password to one UID without losing ledger membership', async () => {
    const key = crypto.randomUUID();
    const email = `link-${key}@example.com`;
    const password = 'OriginalPassword123!';
    const original = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(original.user, { displayName: 'Owner name' });
    await saveProfile(db, original.user);
    const ledgerId = await createLedger(db, original.user, 'Existing ledger', 'CAD');
    const uid = original.user.uid;
    const google = credential(key, email);
    await linkWithCredential(original.user, google);
    await signOut(auth);
    const returned = await signInWithCredential(auth, google);
    await initializeGoogleProfile(db, returned.user);
    expect(returned.user.uid).toBe(uid);
    expect(returned.user.displayName).toBe('Owner name');
    expect((await getDoc(doc(db, 'ledgers', ledgerId))).data()?.ownerId).toBe(uid);
    await signOut(auth);
    expect((await signInWithEmailAndPassword(auth, email, password)).user.uid).toBe(uid);
  });
  it('rejects a Google credential already assigned to a separate UID', async () => {
    const key = crypto.randomUUID();
    const google = credential(key, `owner-${key}@example.com`);
    const owner = await signInWithCredential(auth, google);
    const uid = owner.user.uid;
    await signOut(auth);
    const other = await createUserWithEmailAndPassword(
      auth,
      `other-${key}@example.com`,
      'SeparatePassword123!',
    );
    await expect(linkWithCredential(other.user, google)).rejects.toMatchObject({
      code: 'auth/credential-already-in-use',
    });
    expect(other.user.uid).not.toBe(uid);
    expect(auth.currentUser?.uid).toBe(other.user.uid);
  });
});
