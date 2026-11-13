import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  setPersistence,
} from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
const emulator = import.meta.env.VITE_USE_EMULATORS === 'true';
const config = emulator
  ? {
      apiKey: 'demo-settle-key',
      authDomain: 'demo-settle.firebaseapp.com',
      projectId: 'demo-settle',
      appId: 'demo-settle-app',
    }
  : {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    };
export const configurationError = Object.values(config).some((v) => !v)
  ? 'Firebase is not configured. Copy .env.example to .env.local and enter your Firebase web app settings, or set VITE_USE_EMULATORS=true and start the local emulators. Then restart Vite.'
  : null;
// No pretend production configuration: initialization only happens with complete settings.
const app = configurationError ? null : initializeApp(config);
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
if (auth && db) {
  if (emulator) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
}
export const usingEmulators = emulator;

export const authPersistence = auth
  ? setPersistence(auth, browserLocalPersistence).then(
      () => null,
      () =>
        'Your browser blocked login storage. Enable site storage or use a supported browser, then reload.',
    )
  : Promise.resolve(null);
