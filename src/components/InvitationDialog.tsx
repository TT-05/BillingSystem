import { useTranslation } from 'react-i18next';
import { t } from '../i18n';
import { invitationExpiresAt } from '../domain/invitations';
import { useState, useEffect } from 'react';
import { getDoc, doc } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { Invitation } from '../domain/types';
import { db } from '../services/firebase';
import { acceptInvitation } from '../services/ledger';
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
  useTranslation();
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
      .catch(() => {
        if (live)
          setError(
            'Invitation unavailable. Sign in with the invited email or ask the owner for a new link.',
          );
      })
      .finally(() => {
        if (live) setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, [token]);
  const [now] = useState(() => Date.now());
  const expired = invitation && invitationExpiresAt(invitation).toMillis() < now;
  return (
    <Dialog title={t('You’re invited.')} onClose={onClose} busy={busy}>
      {!loaded ? (
        <p>{t('Opening invitation…')}</p>
      ) : invitation ? (
        <>
          <p>
            {t('Join {{ledger}} ({{currency}}) and start sharing.', {
              ledger: invitation.ledgerName,
              currency: invitation.currency,
            })}
          </p>
          <p className="muted">
            {t('For') + ' '}
            {invitation.email} {' ' + t('· expires') + ' '}
            {dateText(invitationExpiresAt(invitation))}
          </p>
          {(invitation.revoked || invitation.usedBy) && (
            <div className="alert error">
              {t(
                'This invitation is expired, revoked, or already used. Ask the owner for a new one.',
              )}
            </div>
          )}
          {expired && !invitation.revoked && !invitation.usedBy && (
            <p className="field-help">
              {t(
                'This link appears expired based on your device clock. The server checks expiry when you accept.',
              )}
            </p>
          )}
          {!user.emailVerified && (
            <p className="alert">
              {t(
                'Verify your email first. Close this dialog, use the verification actions above, then reopen the invitation link.',
              )}
            </p>
          )}
        </>
      ) : null}
      {error && (
        <div className="alert error" role="alert">
          {t(error)}
        </div>
      )}
      <div className="dialog-footer">
        <button className="secondary" disabled={busy} onClick={onClose}>
          {t('Close')}
        </button>
        {invitation && (
          <button
            className="primary"
            disabled={busy || !user.emailVerified || invitation.revoked || !!invitation.usedBy}
            onClick={() => {
              setBusy(true);
              void acceptInvitation(db!, token, user)
                .then(onJoined)
                .catch(() =>
                  setError(
                    'Unable to accept invitation. Check the invited email, verification, expiry, membership capacity, and connection; ask the owner for a new link if needed.',
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            {busy ? t('Joining…') : t('Accept invitation')}
          </button>
        )}
      </div>
    </Dialog>
  );
}
