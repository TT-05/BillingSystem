import { localizedValidation } from '../i18n/validation';
import { number } from '../i18n/format';
import { useTranslation } from 'react-i18next';
import { t } from '../i18n';
import { invitationExpiresAt } from '../domain/invitations';
import { useState } from 'react';
import { collection, query, where } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { ArrowUpRight, Copy, Layers3 } from 'lucide-react';
import type { Currency, Invitation, Ledger } from '../domain/types';
import { db } from '../services/firebase';
import { invite, revokeInvitation, settings } from '../services/ledger';
import { errorMessage } from '../services/errors';
import { useLive } from '../hooks/useLive';
import { Avatar } from './Avatar';
export function GroupSettings({
  ledger,
  user,
  onNotice,
  onError,
  onLeave,
}: {
  ledger: Ledger;
  user: User;
  onNotice: (s: string) => void;
  onError: (s: string) => void;
  onLeave: () => void;
}) {
  useTranslation();
  const [now] = useState(() => Date.now());
  const isOwner = user.uid === ledger.ownerId;
  const [name, setName] = useState(ledger.name);
  const [currency, setCurrency] = useState(ledger.currency);
  const [email, setEmail] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const invitations = useLive<Invitation & { id: string }>(
    isOwner ? `invitations:${ledger.id}:${user.uid}` : '',
    () =>
      isOwner
        ? query(
            collection(db!, 'invitations'),
            where('ledgerId', '==', ledger.id),
            where('createdBy', '==', user.uid),
          )
        : null,
  );
  const run = async (fn: () => Promise<void>, success: string) => {
    setBusy(true);
    try {
      await fn();
      onNotice(success);
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="settings-layout">
      <div>
        <section className="panel settings-panel">
          <div className="panel-heading">
            <div>
              <h2>{t('The essentials')}</h2>
              <p>{t('A name and a currency to call your own.')}</p>
            </div>
          </div>
          <form
            {...localizedValidation}
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => settings(db!, ledger, name, currency), 'Ledger settings saved.');
            }}
          >
            <label>
              {t('Ledger name')}
              <input
                required
                maxLength={80}
                disabled={!isOwner}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              {t('Currency')}
              <select
                disabled={!isOwner || ledger.hasRecords}
                value={currency}
                onChange={(e) => setCurrency(e.target.value as Currency)}
              >
                <option>CAD</option>
                <option>USD</option>
                <option>CNY</option>
              </select>
            </label>
            <p className="field-help">
              {ledger.hasRecords
                ? t('Currency is locked because this ledger has financial history.')
                : t('Currency locks after the first financial record.')}{' '}
              {t('No currency conversion.')}
            </p>
            {isOwner && (
              <button className="primary" disabled={busy || !name.trim()}>
                {busy ? t('Saving…') : t('Save settings')}
              </button>
            )}
          </form>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>{t('Your people')}</h2>
              <p>
                {t('{{countText}} active members · 5 historical members maximum', {
                  countText: number(ledger.memberIds.length),
                })}
              </p>
            </div>
          </div>
          <div className="member-balances">
            {Object.entries(ledger.members).map(([id, m]) => (
              <div className="member-balance" key={id}>
                <Avatar name={m.name} />
                <div>
                  <strong>
                    {m.name}
                    {id === user.uid ? ' ' + t('(you)') : ''}
                  </strong>
                  <small>
                    {!ledger.memberIds.includes(id)
                      ? t('Left the ledger')
                      : id === ledger.ownerId
                        ? t('Owner · manages settings and invitations')
                        : t('Member · can manage financial records')}
                  </small>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
      <div>
        {isOwner && (
          <section className="panel settings-panel">
            <div className="panel-heading">
              <div>
                <h2>{t('Bring someone in')}</h2>
                <p>{t('A private invitation for one email address.')}</p>
              </div>
            </div>
            <form
              {...localizedValidation}
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const token = await invite(db!, ledger, email, user.uid);
                  setLink(`${window.location.origin}/?invite=${token}`);
                  setEmail('');
                }, 'Invitation created. Share the link privately with the invited person.');
              }}
            >
              <label>
                {t('Their email address')}
                <input
                  required
                  type="email"
                  placeholder={t('friend@example.com')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <p className="field-help">
                {t(
                  'They need an account with a verified matching email. Links expire in 7 days and can be used once. Share the link yourself; no email is sent automatically.',
                )}
              </p>
              {Object.keys(ledger.members).length >= 5 && (
                <p className="field-help">
                  {t(
                    'All five historical member slots are used. Only a former member can rejoin with a new invitation.',
                  )}
                </p>
              )}
              <button className="primary" disabled={busy}>
                {busy ? t('Creating…') : t('Create invitation')}
                <ArrowUpRight size={16} />
              </button>
            </form>
            {link && (
              <div className="invite-link">
                <label>
                  {t('Invitation link')}
                  <input
                    aria-label={t('Invitation link')}
                    readOnly
                    value={link}
                    onFocus={(e) => e.target.select()}
                  />
                </label>
                <button
                  className="secondary small"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(link)
                      .then(() => onNotice('Invitation link copied.'))
                      .catch(() => onError('Copy unavailable. Select and copy the link manually.'))
                  }
                >
                  <Copy size={14} />
                  {t('Copy link')}
                </button>
              </div>
            )}
            {invitations.error && <p className="alert error">{t(invitations.error)}</p>}
            <div className="invitation-list">
              {invitations.items.map((i) => (
                <div key={i.id}>
                  <span>
                    <strong>{i.email}</strong>
                    <small>
                      {i.revoked
                        ? t('Revoked')
                        : i.usedBy
                          ? t('Accepted')
                          : invitationExpiresAt(i).toMillis() < now
                            ? t('Expired')
                            : t('Pending')}
                    </small>
                  </span>
                  {!i.revoked && !i.usedBy && (
                    <button
                      className="text-link"
                      disabled={busy}
                      onClick={() =>
                        void run(() => revokeInvitation(db!, i.id), 'Invitation revoked.')
                      }
                    >
                      {t('Revoke')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
        <section className="permission-card">
          <Layers3 size={24} />
          <h3>{t('A shared ledger. Clear ground rules.')}</h3>
          <p>
            {t(
              'Every member can create, edit, delete, and restore financial entries. Every change is recorded in the immutable history.',
            )}
          </p>
          <p>
            {t(
              'Only the owner can change group settings and invite members. No member can erase financial or audit history.',
            )}
          </p>
          <p>
            {isOwner
              ? t(
                  'As owner, you keep ownership and cannot leave. Ownership transfer and permanent ledger deletion are not available in this version.',
                )
              : t(
                  'You can leave at any time. Your history and debts stay with the ledger; a new invitation is needed to rejoin.',
                )}
          </p>
          {!isOwner && (
            <button className="secondary" onClick={onLeave}>
              {t('Leave ledger')}
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
