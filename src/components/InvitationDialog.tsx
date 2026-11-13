import { useState, useEffect } from 'react';
import { getDoc, doc } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { Invitation } from '../domain/types';
import { db } from '../services/firebase';
import { acceptInvitation } from '../services/ledger';
import { errorMessage } from '../services/errors';
import { dateText } from '../domain/display';
import { Dialog } from './Dialog';
export function InvitationDialog({
  token,
  user,
  onClose,
  onJoined,
}: {
  token: string;
  user: User;
  onClose: () => void;
  onJoined: (id: string) => void;
}) {
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    if (!/^[a-f0-9]{64}$/.test(token)) {
      setError('This invitation link is invalid.');
      setLoaded(true);
      return;
    }
    void getDoc(doc(db!, 'invitations', token))
      .then((s) => {
        if (live) {
          if (s.exists()) setInvitation(s.data() as Invitation);
          else setError('Invitation not found.');
        }
      })
      .catch((e) => {
        if (live) setError(errorMessage(e) + ' Sign in with the exact email that was invited.');
      })
      .finally(() => {
        if (live) setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, [token]);
  const [now] = useState(() => Date.now());
  const expired = invitation && invitation.expiresAt.toMillis() < now;
  return (
    <Dialog title="You’re invited." onClose={onClose} busy={busy}>
      {!loaded ? (
        <p>Opening invitation…</p>
      ) : invitation ? (
        <>
          <p>
            Join <strong>{invitation.ledgerName}</strong> ({invitation.currency}) and start sharing.
          </p>
          <p className="muted">
            For {invitation.email} · expires {dateText(invitation.expiresAt)}
          </p>
          {(expired || invitation.revoked || invitation.usedBy) && (
            <div className="alert error">
              This invitation is expired, revoked, or already used. Ask the owner for a new one.
            </div>
          )}
          {!user.emailVerified && (
            <p className="alert">
              Verify your email first. Close this dialog, use the verification actions above, then
              reopen the invitation link.
            </p>
          )}
        </>
      ) : null}
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <div className="dialog-footer">
        <button className="secondary" disabled={busy} onClick={onClose}>
          Close
        </button>
        {invitation && (
          <button
            className="primary"
            disabled={
              busy || !user.emailVerified || !!expired || invitation.revoked || !!invitation.usedBy
            }
            onClick={() => {
              setBusy(true);
              void acceptInvitation(db!, token, user)
                .then(onJoined)
                .catch((e) => setError(errorMessage(e)))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? 'Joining…' : 'Accept invitation'}
          </button>
        )}
      </div>
    </Dialog>
  );
}
