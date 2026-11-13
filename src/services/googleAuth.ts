import { GoogleAuthProvider, linkWithPopup, signInWithPopup, updateProfile } from 'firebase/auth';
import type { Auth, User } from 'firebase/auth';
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';

export function googleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

// Start the popup directly from the click handler; do not persist OAuth tokens.
export function signInWithGoogle(auth: Auth) {
  return signInWithPopup(auth, googleProvider());
}

// Linking requires an authenticated account AND a new Google sign-in. Firebase
// rejects credentials owned by another UID; we never merge, migrate, or delete users.
export async function linkGoogleAccount(user: User): Promise<void> {
  const uid = user.uid;
  const result = await linkWithPopup(user, googleProvider());
  if (result.user.uid !== uid) throw new Error('Your account changed. Sign out and sign in again.');
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
