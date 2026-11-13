import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Auth, User } from 'firebase/auth';
import { GoogleAuthProvider } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
const mocks = vi.hoisted(() => ({
  popup: vi.fn(),
  link: vi.fn(),
  update: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('firebase/auth', async (original) => ({
  ...(await original<typeof import('firebase/auth')>()),
  signInWithPopup: mocks.popup,
  linkWithPopup: mocks.link,
  updateProfile: mocks.update,
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  serverTimestamp: () => 'SERVER_TIME',
  runTransaction: mocks.transaction,
}));
import {
  googleProvider,
  initializeGoogleProfile,
  linkGoogleAccount,
  signInWithGoogle,
} from '../src/services/googleAuth';
import { errorMessage } from '../src/services/errors';
const auth = {} as Auth,
  db = {} as Firestore;
const user = (overrides: Partial<User> = {}): User =>
  ({
    uid: 'stable-uid',
    email: 'friend@example.com',
    displayName: 'Google Name',
    providerData: [{ providerId: 'google.com' }],
    ...overrides,
  }) as User;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation(async (_db, fn) => fn({ get: mocks.get, set: mocks.set }));
  mocks.get.mockResolvedValue({ exists: () => false });
  mocks.update.mockResolvedValue(undefined);
});
describe('Google authentication and profiles', () => {
  it('requests an account chooser without additional Google API scopes', () => {
    const parameters = vi.spyOn(GoogleAuthProvider.prototype, 'setCustomParameters');
    const p = googleProvider();
    expect(p.providerId).toBe('google.com');
    expect(parameters).toHaveBeenCalledWith({ prompt: 'select_account' });
    parameters.mockRestore();
    expect(p.getScopes()).not.toContain('https://www.googleapis.com/auth/drive');
  });
  it('opens the Firebase sign-in popup directly and does not write profile or financial data', async () => {
    const result = { user: user() };
    mocks.popup.mockResolvedValue(result);
    expect(await signInWithGoogle(auth)).toBe(result);
    expect(mocks.popup).toHaveBeenCalledWith(
      auth,
      expect.objectContaining({ providerId: 'google.com' }),
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('links Google to an already authenticated UID', async () => {
    const u = user();
    mocks.link.mockResolvedValue({ user: u });
    await linkGoogleAccount(u);
    expect(mocks.link).toHaveBeenCalledWith(
      u,
      expect.objectContaining({ providerId: 'google.com' }),
    );
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it('refuses an unexpected UID change during linking', async () => {
    mocks.link.mockResolvedValue({ user: user({ uid: 'other-uid' }) });
    await expect(linkGoogleAccount(user())).rejects.toThrow('account changed');
  });
  it('preserves Firebase credential conflict errors without merging identities', async () => {
    const conflict = { code: 'auth/credential-already-in-use' };
    mocks.link.mockRejectedValue(conflict);
    await expect(linkGoogleAccount(user())).rejects.toBe(conflict);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('leaves password-only registration behavior untouched', async () => {
    await initializeGoogleProfile(
      db,
      user({ providerData: [{ providerId: 'password' }] as User['providerData'] }),
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('creates only the new user profile with a server timestamp', async () => {
    await initializeGoogleProfile(db, user());
    expect(mocks.set).toHaveBeenCalledWith('users/stable-uid', {
      name: 'Google Name',
      updatedAt: 'SERVER_TIME',
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('preserves a customized profile name when Google refreshes its own name', async () => {
    mocks.get.mockResolvedValue({ exists: () => true, data: () => ({ name: 'My chosen name' }) });
    const u = user();
    await initializeGoogleProfile(db, u);
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(u, { displayName: 'My chosen name' });
  });
  it('normalizes missing and overly long Google names to the existing profile constraints', async () => {
    await initializeGoogleProfile(db, user({ displayName: null }));
    expect(mocks.set).toHaveBeenLastCalledWith('users/stable-uid', {
      name: 'friend',
      updatedAt: 'SERVER_TIME',
    });
    await initializeGoogleProfile(db, user({ displayName: 'x'.repeat(120) }));
    expect(mocks.set.mock.calls[1][1].name).toHaveLength(80);
  });
  it('does not overwrite an invalid existing profile or mask Firestore failure', async () => {
    mocks.get.mockResolvedValue({ exists: () => true, data: () => ({ name: '' }) });
    await expect(initializeGoogleProfile(db, user())).rejects.toThrow('saved profile');
    expect(mocks.set).not.toHaveBeenCalled();
    mocks.get.mockRejectedValue(new Error('Offline'));
    await expect(initializeGoogleProfile(db, user())).rejects.toThrow('Offline');
  });
});
describe('actionable authentication errors', () => {
  it('guides credential conflicts through authenticated explicit linking', () => {
    expect(errorMessage({ code: 'auth/account-exists-with-different-credential' })).toContain(
      'original method',
    );
    expect(errorMessage({ code: 'auth/credential-already-in-use' })).toContain(
      'No accounts or ledgers were merged',
    );
  });
  it.each([
    'auth/popup-blocked',
    'auth/popup-closed-by-user',
    'auth/cancelled-popup-request',
    'auth/unauthorized-domain',
    'auth/provider-already-linked',
    'auth/requires-recent-login',
  ])('explains %s without exposing credentials', (code) => {
    const text = errorMessage({ code });
    expect(text.length).toBeGreaterThan(25);
    expect(text).not.toContain('Something went wrong');
  });
});
