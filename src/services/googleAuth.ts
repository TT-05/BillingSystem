import i18n from '../i18n';
import {
  GoogleAuthProvider,
  getRedirectResult,
  linkWithPopup,
  linkWithRedirect,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updateProfile,
} from 'firebase/auth';
import type { Auth, User } from 'firebase/auth';
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';

export function googleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

const REDIRECT_KEY = 'settle-google-redirect';
export function preferGoogleRedirect(
  device?: Pick<Navigator, 'userAgent' | 'maxTouchPoints'>,
): boolean {
  return (
    !!device &&
    (/Android|iPhone|iPad|iPod/i.test(device.userAgent) ||
      (/Macintosh/i.test(device.userAgent) && device.maxTouchPoints > 1))
  );
}
export function googleRedirectBridge(
  currentUrl: string,
  projectId?: string,
  authDomain?: string,
): string | null {
  const current = new URL(currentUrl);
  if (
    projectId !== 'bill9206' ||
    current.hostname !== 'bill9206.web.app' ||
    authDomain !== 'bill9206.firebaseapp.com'
  )
    return null;
  // Use the project's existing, authorized Hosting/auth origin. No tokens or
  // account identifiers cross origins, and no arbitrary return URL is accepted.
  current.hostname = 'bill9206.firebaseapp.com';
  current.protocol = 'https:';
  current.port = '';
  current.searchParams.set('googleRedirect', 'signin');
  return current.toString();
}
export async function startGoogleRedirect(auth: Auth, user?: User): Promise<void> {
  if (typeof window !== 'undefined') {
    const bridge = googleRedirectBridge(
      window.location.href,
      auth.app?.options.projectId,
      auth.app?.options.authDomain,
    );
    if (bridge) {
      if (user)
        throw new Error(
          'For redirect linking, open bill9206.firebaseapp.com, sign in with your existing method, and link Google there.',
        );
      const url = new URL(bridge);
      const language = localStorage.getItem('settle-language');
      if (language === 'en' || language === 'zh-CN') url.searchParams.set('uiLanguage', language);
      window.location.assign(url.toString());
      return;
    }
    try {
      sessionStorage.setItem(
        REDIRECT_KEY,
        JSON.stringify({ mode: user ? 'link' : 'signin', uid: user?.uid ?? null }),
      );
    } catch {
      throw new Error(
        'Your browser blocked login storage. Enable site storage or use a supported browser, then reload.',
      );
    }
  }
  if (user) await linkWithRedirect(user, googleProvider());
  else await signInWithRedirect(auth, googleProvider());
}
// Run before auth-state UI is mounted, even if the canonical Hosting alias
// already holds another account's session. A sign-in intent must still prompt
// Google, rather than exposing whichever cached account happened to be there.
export async function continueGoogleRedirectBridge(auth: Auth): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const url = new URL(window.location.href);
  if (
    auth.app?.options.projectId !== 'bill9206' ||
    url.hostname !== 'bill9206.firebaseapp.com' ||
    url.searchParams.get('googleRedirect') !== 'signin'
  )
    return false;
  const language = url.searchParams.get('uiLanguage');
  url.searchParams.delete('googleRedirect');
  url.searchParams.delete('uiLanguage');
  window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  if (language === 'en' || language === 'zh-CN') await i18n.changeLanguage(language);
  await startGoogleRedirect(auth);
  return true;
}
export async function finishGoogleRedirect(auth: Auth): Promise<void> {
  const result = await getRedirectResult(auth);
  if (typeof window === 'undefined') return;
  const saved = sessionStorage.getItem(REDIRECT_KEY);
  sessionStorage.removeItem(REDIRECT_KEY);
  if (!result || !saved) return;
  const marker = JSON.parse(saved) as { mode: string; uid: string | null };
  if (marker.mode === 'link' && result.user.uid !== marker.uid) {
    await signOut(auth);
    throw new Error('Your account changed. Sign out and sign in again.');
  }
}
// Keep the popup tied to the click on desktop. Mobile prefers redirect; a
// blocked popup falls back, but closing a popup never starts a surprise redirect.
export async function signInWithGoogle(auth: Auth) {
  if (preferGoogleRedirect(typeof navigator === 'undefined' ? undefined : navigator))
    return startGoogleRedirect(auth);
  try {
    return await signInWithPopup(auth, googleProvider());
  } catch (error) {
    if (
      typeof error === 'object' &&
      error &&
      'code' in error &&
      error.code === 'auth/popup-blocked'
    )
      return startGoogleRedirect(auth);
    throw error;
  }
}
export async function linkGoogleAccount(user: User, auth?: Auth): Promise<void> {
  const uid = user.uid;
  try {
    const result = await linkWithPopup(user, googleProvider());
    if (result.user.uid !== uid)
      throw new Error('Your account changed. Sign out and sign in again.');
  } catch (error) {
    if (
      typeof error === 'object' &&
      error &&
      'code' in error &&
      error.code === 'auth/popup-blocked'
    ) {
      if (!auth) throw new Error('Your account changed. Sign out and sign in again.');
      return startGoogleRedirect(auth, user);
    }
    throw error;
  }
}

export async function initializeGoogleProfile(db: Firestore, user: User): Promise<void> {
  if (!user.providerData.some((p) => p.providerId === 'google.com')) return;
  const fallback = (user.displayName?.trim() || user.email?.split('@')[0] || 'Member').slice(0, 80);
  const name = await runTransaction(db, async (tx) => {
    const ref = doc(db, 'users', user.uid);
    const existing = await tx.get(ref);
    if (existing.exists()) {
      const saved = existing.data().name;
      if (typeof saved !== 'string' || !saved.trim() || saved.length > 80)
        throw new Error(
          'Your saved profile could not be loaded. Retry or contact the project administrator.',
        );
      return saved;
    }
    tx.set(ref, { name: fallback, updatedAt: serverTimestamp() });
    return fallback;
  });
  // Preserve an existing app-specific name across Google's provider profile refresh.
  if (user.displayName !== name) await updateProfile(user, { displayName: name });
}
