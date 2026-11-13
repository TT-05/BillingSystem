import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Auth, User } from 'firebase/auth';
const calls = vi.hoisted(() => ({
  popup: vi.fn(),
  redirect: vi.fn(),
  linkPopup: vi.fn(),
  linkRedirect: vi.fn(),
  result: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('firebase/auth', async (original) => ({
  ...(await original<typeof import('firebase/auth')>()),
  signInWithPopup: calls.popup,
  signInWithRedirect: calls.redirect,
  linkWithPopup: calls.linkPopup,
  linkWithRedirect: calls.linkRedirect,
  getRedirectResult: calls.result,
  signOut: calls.signOut,
}));
import {
  continueGoogleRedirectBridge,
  finishGoogleRedirect,
  googleRedirectBridge,
  linkGoogleAccount,
  preferGoogleRedirect,
  signInWithGoogle,
  startGoogleRedirect,
} from '../src/services/googleAuth';
const auth = {
  app: { options: { projectId: 'demo-settle', authDomain: 'demo-settle.firebaseapp.com' } },
} as Auth;
const user = { uid: 'original' } as User;
let saved: Map<string, string>;
beforeEach(() => {
  vi.resetAllMocks();
  saved = new Map();
  vi.stubGlobal('navigator', { userAgent: 'Desktop Chrome', maxTouchPoints: 0 });
  vi.stubGlobal('window', {
    location: { href: 'http://localhost:5173/?invite=private-token', assign: vi.fn() },
  });
  vi.stubGlobal('sessionStorage', {
    setItem: (k: string, v: string) => saved.set(k, v),
    getItem: (k: string) => saved.get(k) ?? null,
    removeItem: (k: string) => saved.delete(k),
  });
  vi.stubGlobal('localStorage', { getItem: () => 'en' });
});
afterEach(() => vi.unstubAllGlobals());
describe('mobile redirect and popup fallback without account merging', () => {
  it.each(['iPhone Safari', 'iPad Safari', 'Android Chrome', 'Macintosh Safari'])(
    'prefers redirect on supported mobile %s',
    (agent) => {
      expect(preferGoogleRedirect({ userAgent: agent, maxTouchPoints: 5 })).toBe(true);
    },
  );
  it('keeps desktop popup behavior', async () => {
    expect(preferGoogleRedirect({ userAgent: 'Desktop Chrome', maxTouchPoints: 0 })).toBe(false);
    calls.popup.mockResolvedValue({ user });
    await expect(signInWithGoogle(auth)).resolves.toEqual({ user });
    expect(calls.redirect).not.toHaveBeenCalled();
  });
  it('starts redirect directly on mobile', async () => {
    vi.stubGlobal('navigator', { userAgent: 'iPhone Safari', maxTouchPoints: 5 });
    await signInWithGoogle(auth);
    expect(calls.redirect).toHaveBeenCalled();
    expect(calls.popup).not.toHaveBeenCalled();
    expect(JSON.parse(saved.get('settle-google-redirect')!).mode).toBe('signin');
  });
  it('falls back after a blocked popup', async () => {
    calls.popup.mockRejectedValue({ code: 'auth/popup-blocked' });
    await signInWithGoogle(auth);
    expect(calls.redirect).toHaveBeenCalledWith(
      auth,
      expect.objectContaining({ providerId: 'google.com' }),
    );
  });
  it.each([
    'auth/popup-closed-by-user',
    'auth/account-exists-with-different-credential',
    'auth/credential-already-in-use',
  ])('does not redirect automatically after %s', async (code) => {
    calls.popup.mockRejectedValue({ code });
    await expect(signInWithGoogle(auth)).rejects.toEqual({ code });
    expect(calls.redirect).not.toHaveBeenCalled();
  });
  it('bridges only the known project Hosting alias and preserves the invitation URL', () => {
    const url = googleRedirectBridge(
      'https://bill9206.web.app/?invite=token',
      'bill9206',
      'bill9206.firebaseapp.com',
    )!;
    expect(new URL(url).origin).toBe('https://bill9206.firebaseapp.com');
    expect(new URL(url).searchParams.get('invite')).toBe('token');
    expect(new URL(url).searchParams.get('googleRedirect')).toBe('signin');
    for (const origin of [
      'https://attacker.test',
      'https://bill9206.firebaseapp.com',
      'http://localhost:5173',
    ])
      expect(googleRedirectBridge(origin, 'bill9206', 'bill9206.firebaseapp.com')).toBeNull();
    expect(
      googleRedirectBridge('https://bill9206.web.app', 'other', 'bill9206.firebaseapp.com'),
    ).toBeNull();
  });
  it('preserves selected language on the top-level canonical-origin fallback', async () => {
    window.location.href = 'https://bill9206.web.app/?invite=token';
    await startGoogleRedirect({
      app: { options: { projectId: 'bill9206', authDomain: 'bill9206.firebaseapp.com' } },
    } as Auth);
    expect(window.location.assign).toHaveBeenCalledWith(
      'https://bill9206.firebaseapp.com/?invite=token&googleRedirect=signin&uiLanguage=en',
    );
    expect(calls.redirect).not.toHaveBeenCalled();
  });
  it('links by redirect only with the authenticated user, not a new sign-in', async () => {
    calls.linkPopup.mockRejectedValue({ code: 'auth/popup-blocked' });
    await linkGoogleAccount(user, auth);
    expect(calls.linkRedirect).toHaveBeenCalledWith(
      user,
      expect.objectContaining({ providerId: 'google.com' }),
    );
    expect(calls.redirect).not.toHaveBeenCalled();
    expect(JSON.parse(saved.get('settle-google-redirect')!).uid).toBe('original');
  });
  it('refuses to move an authenticated linking session across origins', async () => {
    window.location.href = 'https://bill9206.web.app/';
    await expect(
      startGoogleRedirect(
        {
          app: { options: { projectId: 'bill9206', authDomain: 'bill9206.firebaseapp.com' } },
        } as Auth,
        user,
      ),
    ).rejects.toThrow('existing method');
    expect(calls.linkRedirect).not.toHaveBeenCalled();
    expect(window.location.assign).not.toHaveBeenCalled();
  });
  it('consumes redirect result and clears intent without persisting OAuth credentials', async () => {
    saved.set('settle-google-redirect', JSON.stringify({ mode: 'link', uid: 'original' }));
    calls.result.mockResolvedValue({ user });
    await finishGoogleRedirect(auth);
    expect(saved.size).toBe(0);
    expect(calls.signOut).not.toHaveBeenCalled();
  });
  it('signs out if a redirect linking result changes UID', async () => {
    saved.set('settle-google-redirect', JSON.stringify({ mode: 'link', uid: 'original' }));
    calls.result.mockResolvedValue({ user: { uid: 'different' } });
    await expect(finishGoogleRedirect(auth)).rejects.toThrow('account changed');
    expect(calls.signOut).toHaveBeenCalledWith(auth);
  });
  it('reports storage failure without starting an unusable redirect', async () => {
    vi.stubGlobal('sessionStorage', {
      setItem: () => {
        throw Error('blocked');
      },
    });
    await expect(startGoogleRedirect(auth)).rejects.toThrow('blocked login storage');
    expect(calls.redirect).not.toHaveBeenCalled();
  });
  it('processes a canonical-origin bridge intent before exposing a previously signed-in UID', async () => {
    window.location.href =
      'https://bill9206.firebaseapp.com/?invite=token&googleRedirect=signin&uiLanguage=en';
    window.history = { replaceState: vi.fn() } as unknown as History;
    const existing = {
      app: { options: { projectId: 'bill9206', authDomain: 'bill9206.firebaseapp.com' } },
      currentUser: { uid: 'cached-other-account' },
    } as Auth;
    expect(await continueGoogleRedirectBridge(existing)).toBe(true);
    expect(calls.redirect).toHaveBeenCalledWith(
      existing,
      expect.objectContaining({ providerId: 'google.com' }),
    );
    expect(window.history.replaceState).toHaveBeenCalledWith({}, '', '/?invite=token');
  });
  it('ignores redirect intent on unrelated origins', async () => {
    window.location.href = 'https://attacker.test/?googleRedirect=signin';
    expect(await continueGoogleRedirectBridge(auth)).toBe(false);
    expect(calls.redirect).not.toHaveBeenCalled();
  });
});
