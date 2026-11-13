import { useState } from 'react';
import { updateProfile } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { db } from '../services/firebase';
import { saveProfile } from '../services/ledger';
import { errorMessage } from '../services/errors';
import { Dialog } from './Dialog';
import { linkGoogleAccount } from '../services/googleAuth';
export function Profile({
  user,
  onClose,
  onSaved,
}: {
  user: User;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(user.displayName || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [googleLinked, setGoogleLinked] = useState(() =>
    user.providerData.some((p) => p.providerId === 'google.com'),
  );
  async function connectGoogle() {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await linkGoogleAccount(user);
      setGoogleLinked(true);
      setNotice('Google connected. Both sign-in methods use the same account and ledger history.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Your profile" onClose={onClose} busy={busy}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void (async () => {
            try {
              await updateProfile(user, { displayName: name.trim() });
              await saveProfile(db!, user);
              onSaved();
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <label>
          Display name
          <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <p className="muted">{user.email}</p>
        <p className="field-help">
          Your UID stays the same. Ledger names are captured at joining so history remains readable.
        </p>
        {error && <div className="alert error">{error}</div>}
        <div className="dialog-footer">
          <button className="primary" disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </form>
      <section className="profile-signin" aria-label="Sign-in methods">
        <h3>Sign-in methods</h3>
        <p className="field-help">
          {user.providerData.some((p) => p.providerId === 'password') ? 'Email/password' : ''}
          {user.providerData.some((p) => p.providerId === 'password') && googleLinked ? ' · ' : ''}
          {googleLinked ? 'Google' : ''}
        </p>
        <p className="field-help">
          Link Google only to the account you want to keep. This preserves your UID and ledger
          history. A Google account already owned by another UID cannot be merged here.
        </p>
        {notice && (
          <div className="alert success" role="status">
            {notice}
          </div>
        )}
        <button
          type="button"
          className="secondary full"
          disabled={busy || googleLinked}
          onClick={() => void connectGoogle()}
        >
          {googleLinked ? 'Google connected' : 'Link Google account'}
        </button>
      </section>
    </Dialog>
  );
}
