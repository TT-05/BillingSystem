import { localizedValidation } from '../i18n/validation';
import { useTranslation } from 'react-i18next';
import { t } from '../i18n';
import { useState } from 'react';
import type { FormEvent } from 'react';
import type { User } from 'firebase/auth';
import type { Currency } from '../domain/types';
import { db } from '../services/firebase';
import { createLedger } from '../services/ledger';
import { errorMessage } from '../services/errors';
import { Dialog } from './Dialog';
export function LedgerForm({
  user,
  onClose,
  onSaved,
}: {
  uid: string;
  user: User;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  useTranslation();
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<Currency>('CAD');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (!name.trim()) throw new Error('Enter a ledger name.');
      onSaved(await createLedger(db!, user, name, currency));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={t('Create a shared ledger')} onClose={onClose} busy={busy}>
      <form {...localizedValidation} onSubmit={(e) => void submit(e)}>
        <p className="muted">{t('A fresh space for the things you share.')}</p>
        <label>
          {t('Ledger name')}
          <input
            autoFocus
            required
            maxLength={80}
            placeholder={t('e.g. The Maple House')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          {t('Ledger currency')}
          <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
            <option value="CAD">{t('CAD — Canadian dollar')}</option>
            <option value="USD">{t('USD — US dollar')}</option>
            <option value="CNY">{t('CNY — Chinese yuan')}</option>
          </select>
        </label>
        <p className="field-help">
          {t('One currency per ledger. Locked after the first financial record.')}
        </p>
        {error && (
          <div className="alert error" role="alert">
            {t(error)}
          </div>
        )}
        <div className="dialog-footer">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            {t('Cancel')}
          </button>
          <button className="primary" disabled={busy}>
            {busy ? t('Creating…') : t('Create ledger')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
