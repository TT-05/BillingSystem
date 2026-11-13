import { localizedValidation } from '../i18n/validation';
import { LanguageSelector } from './LanguageSelector';
import { useTranslation } from 'react-i18next';
import { t } from '../i18n';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
import { ArrowUpRight, Check, Layers3 } from 'lucide-react';
import { auth, authPersistence, db, usingEmulators } from '../services/firebase';
import { errorMessage } from '../services/errors';
import { saveProfile } from '../services/ledger';
import { signInWithGoogle } from '../services/googleAuth';
export function AuthScreen({ invited }: { invited: boolean }) {
  useTranslation();
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  useEffect(() => {
    let active = true;
    void authPersistence.then((problem) => {
      if (!active) return;
      if (problem) setError(problem);
      else setGoogleReady(true);
    });
    return () => {
      active = false;
    };
  }, []);
  async function googleSignIn() {
    if (!auth || busy || !googleReady) return;
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await signInWithGoogle(auth);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      if (!auth || !db) return;
      const persistenceError = await authPersistence;
      if (persistenceError) throw new Error(persistenceError);
      if (mode === 'register' && !name.trim()) throw new Error('Enter your display name.');
      if (mode === 'reset') {
        await sendPasswordResetEmail(auth, email);
        setNotice('If an account exists, a reset link has been sent. Check your inbox.');
      } else if (mode === 'register') {
        const result = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(result.user, { displayName: name.trim() });
        await saveProfile(db, result.user);
        await sendEmailVerification(result.user);
      } else await signInWithEmailAndPassword(auth, email, password);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout">
      <div className="auth-story">
        <a className="brand" href="/">
          <span className="brand-symbol">
            <Layers3 size={24} />
          </span>
          settle<span className="brand-dot">.</span>
        </a>
        <div>
          <span className="eyebrow light">{t('LESS MATH. MORE LIVING.')}</span>
          <h1>
            {t('Good friends.')}
            <br />
            {t('Clear balances.')}
          </h1>
          <p>
            {t('A little clarity for the things you share.')}
            <br />
            {t('Split fairly, settle simply, stay in sync.')}
          </p>
          <div className="story-card">
            <span className="story-check">
              <Check size={19} />
            </span>
            <div>
              {t('One less thing to keep track of.')}
              <small>{t('Private ledgers. Every change accounted for.')}</small>
            </div>
          </div>
        </div>
        <span className="auth-foot">{t('MADE FOR THE PEOPLE YOU SHARE LIFE WITH')}</span>
      </div>
      <main className="auth-form">
        <div className="auth-inner">
          <LanguageSelector />
          <span className="eyebrow">{t('YOUR SHARED SPACE')}</span>
          <h2>
            {mode === 'register'
              ? t('Make yourself at home.')
              : mode === 'reset'
                ? t('Let’s get you back in.')
                : t('Welcome back.')}
          </h2>
          <p className="muted">
            {invited
              ? t('Sign in with the invited email to open your invitation.')
              : mode === 'register'
                ? t('Create an account. Start sharing with confidence.')
                : t('Your expenses, all in one peaceful place.')}
          </p>
          <form {...localizedValidation} onSubmit={(e) => void submit(e)}>
            {mode === 'register' && (
              <label>
                {t('Display name')}
                <input
                  required
                  maxLength={80}
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            )}
            <label>
              {t('Email address')}
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            {mode !== 'reset' && (
              <label>
                {t('Password')}
                <input
                  type="password"
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            )}
            {error && (
              <div className="alert error" role="alert">
                {t(error)}
              </div>
            )}
            {notice && (
              <div className="alert success" role="status">
                {t(notice)}
              </div>
            )}
            <button className="primary full" disabled={busy}>
              {busy
                ? t('Please wait…')
                : mode === 'register'
                  ? t('Create account')
                  : mode === 'reset'
                    ? t('Send reset link')
                    : t('Sign in')}
              <ArrowUpRight size={18} />
            </button>
          </form>
          {mode !== 'reset' && (
            <>
              <div className="auth-divider">
                <span>{t('or')}</span>
              </div>
              <button
                type="button"
                className="secondary full google-button"
                disabled={busy || !googleReady}
                onClick={() => void googleSignIn()}
              >
                <span aria-hidden="true" className="google-mark">
                  G
                </span>{' '}
                {t('Continue with Google')}
              </button>
              <p className="field-help google-help">
                {t(
                  'Use your existing sign-in method if this email already has an account. You can link Google from Account & profile.',
                )}
              </p>
            </>
          )}
          <div className="auth-links">
            <button
              onClick={() => {
                setMode(mode === 'register' ? 'login' : 'register');
                setError('');
              }}
            >
              {mode === 'register'
                ? t('Already have an account? Sign in')
                : t('New here? Create an account')}
            </button>
            {mode === 'login' && (
              <button onClick={() => setMode('reset')}>{t('Forgot password?')}</button>
            )}
            {mode === 'reset' && (
              <button onClick={() => setMode('login')}>{t('Back to sign in')}</button>
            )}
          </div>
          {usingEmulators && (
            <div className="emulator-label">{t('LOCAL EMULATOR · test data only')}</div>
          )}
        </div>
      </main>
    </div>
  );
}
