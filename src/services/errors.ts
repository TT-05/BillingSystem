export function errorMessage(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  const messages: Record<string, string> = {
    'auth/popup-closed-by-user':
      'Google sign-in was cancelled. Try again or use email and password.',
    'auth/cancelled-popup-request': 'Another sign-in window was opened. Close it and try again.',
    'auth/popup-blocked':
      'Your browser blocked the Google sign-in window. Allow popups for this site and try again.',
    'auth/unauthorized-domain':
      'This domain is not authorized for sign-in. Add it to Firebase Authentication > Settings > Authorized domains.',
    'auth/account-exists-with-different-credential':
      'An existing account uses this email. Sign in with its original method, then open Account & profile and choose Link Google account. No ledger data has been merged.',
    'auth/credential-already-in-use':
      'This Google account belongs to a different Firebase account. No accounts or ledgers were merged. Sign in to the account whose history you want to keep.',
    'auth/email-already-in-use':
      'An account already uses this email. Use its existing sign-in method or reset its password. You can link Google after signing in.',
    'auth/provider-already-linked':
      'Google is already connected to this account. Close and reopen your profile to refresh its status.',
    'auth/requires-recent-login':
      'Sign out, sign back in with your existing method, then try linking Google again.',
    'auth/user-mismatch':
      'The selected account does not match this session. Sign out and sign in to the account you want to keep.',

    'auth/user-disabled':
      'This account has been disabled. Contact the ledger owner or Firebase project administrator.',
    'auth/web-storage-unsupported': 'Enable site storage in your browser to sign in.',
    'auth/operation-not-allowed':
      'This sign-in provider is not enabled. Ask the project administrator to enable it in Firebase Authentication.',
    'auth/user-not-found': 'The email or password is incorrect.',
    'auth/wrong-password': 'The email or password is incorrect.',
    'auth/invalid-credential': 'The email or password is incorrect.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/weak-password': 'Use a password with at least 6 characters.',
    'auth/too-many-requests': 'Too many attempts. Please try again later.',
    'auth/network-request-failed': 'Unable to connect. Check your internet connection.',
    'permission-denied':
      'Access denied. Your membership may have changed, or this operation is not permitted.',
    unavailable:
      'The server is unavailable. Your changes have not been saved. Reconnect and try again.',
  };
  return (
    messages[code] ||
    (error instanceof Error ? error.message : 'Something went wrong. Please try again.')
  );
}
