import { localizedValidation } from '../i18n/validation';
import { money, localDateISO, financialText } from '../i18n/format';
import { useTranslation } from 'react-i18next';
import { t } from '../i18n';
import { useState } from 'react';
import type { FormEvent } from 'react';
import type { FinancialData, FinancialRecord, Kind, Ledger, SplitMethod } from '../domain/types';
import { inputMoney, parseMoney, parsePercent, split } from '../domain/finance';
import { db } from '../services/firebase';
import { errorMessage } from '../services/errors';
import { newRecordId, writeFinancial } from '../services/ledger';
import { Dialog } from './Dialog';
export function RecordForm({
  ledger,
  uid,
  record,
  kind = 'expense',
  onClose,
  onSaved,
}: {
  ledger: Ledger;
  uid: string;
  record?: FinancialRecord;
  kind?: Kind;
  onClose: () => void;
  onSaved: () => void;
}) {
  useTranslation();
  const old = record?.data;
  const [recordId] = useState(() => record?.id || newRecordId(db!, ledger.id));
  const [type, setType] = useState<Kind>(old?.kind || kind);
  const [description, setDescription] = useState(old?.description || '');
  const [total, setTotal] = useState(old ? inputMoney(old.amount) : '');
  const [date, setDate] = useState(old?.date || localDateISO());
  const [payer, setPayer] = useState(old?.payerId || uid);
  const [receiver, setReceiver] = useState(
    old?.receiverId || ledger.memberIds.find((x) => x !== uid) || '',
  );
  const [ids, setIds] = useState<string[]>(old?.participants || [...ledger.memberIds].sort());
  const [method, setMethod] = useState<SplitMethod>(old?.splitMethod || 'equal');
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.keys(ledger.members).map((id) => [
        id,
        old?.weights[id] !== undefined
          ? old.splitMethod === 'percentage'
            ? inputMoney(old.weights[id])
            : inputMoney(old.shares[id])
          : '',
      ]),
    ),
  );
  const [notes, setNotes] = useState(old?.notes || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  let preview: Record<string, number> = {};
  let previewError = '';
  try {
    if (type === 'expense' && total) {
      const weights = Object.fromEntries(
        ids.map((id) => [
          id,
          method === 'equal'
            ? 1
            : method === 'percentage'
              ? parsePercent(values[id] || '0')
              : parseMoney(values[id] || '0', true),
        ]),
      );
      preview = split(parseMoney(total), ids, method, weights);
    }
  } catch (e) {
    previewError = errorMessage(e);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const amount = parseMoney(total);
      const participants = type === 'expense' ? [...ids].sort() : [];
      if (type !== 'expense' && (!receiver || payer === receiver))
        throw new Error('Choose two different members.');
      const weights = Object.fromEntries(
        participants.map((id) => [
          id,
          method === 'equal'
            ? 1
            : method === 'percentage'
              ? parsePercent(values[id] || '0')
              : parseMoney(values[id] || '0', true),
        ]),
      );
      const shares = type === 'expense' ? split(amount, participants, method, weights) : {};
      const data: FinancialData = {
        kind: type,
        description: description.trim(),
        amount,
        currency: ledger.currency,
        date,
        payerId: payer,
        receiverId: type === 'expense' ? '' : receiver,
        participants,
        shares,
        weights,
        splitMethod: type === 'expense' ? method : 'equal',
        notes: notes.trim(),
        deleted: false,
        settlementKey: old?.settlementKey || '',
      };
      if (!description.trim()) throw new Error('Enter a description.');
      await writeFinancial(db!, {
        ledgerId: ledger.id,
        id: recordId,
        data,
        actorId: uid,
        expectedVersion: record?.version || 0,
        action: record ? 'edit' : 'create',
      });
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const options = Object.entries(ledger.members).map(([id, m]) => (
    <option key={id} value={id}>
      {m.name}
      {!ledger.memberIds.includes(id) ? ' ' + t('(left group)') : ''}
    </option>
  ));
  return (
    <Dialog
      title={record ? t('Edit transaction') : t('Add a transaction')}
      onClose={onClose}
      busy={busy}
    >
      <form {...localizedValidation} onSubmit={(e) => void submit(e)} className="record-form">
        <fieldset disabled={busy} className="form-body">
          <div className="segmented" role="group" aria-label={t('Transaction type')}>
            {(['expense', 'loan'] as Kind[]).map((k) => (
              <button
                type="button"
                key={k}
                disabled={!!record}
                aria-pressed={type === k}
                className={type === k ? 'selected' : ''}
                onClick={() => setType(k)}
              >
                {k === 'expense' ? t('Expense') : k === 'loan' ? t('Direct loan') : t('Repayment')}
              </button>
            ))}
          </div>
          <label>
            {t('Description')}
            <input
              autoFocus
              required
              maxLength={120}
              placeholder={
                type === 'expense'
                  ? t('e.g. Sunday groceries')
                  : type === 'loan'
                    ? t('e.g. Lent money for concert tickets')
                    : t('e.g. Paid back for groceries')
              }
              value={
                old && description === old.description
                  ? financialText(old, 'description')
                  : description
              }
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <div className="form-grid">
            <label>
              {t('Amount (')}
              {ledger.currency})
              <input
                required
                inputMode="decimal"
                placeholder="0.00"
                value={total}
                onChange={(e) => setTotal(e.target.value)}
              />
            </label>
            <label>
              {t('Date')}
              <input required type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label>
              {type === 'loan' ? t('Lent by') : t('Paid by')}
              <select value={payer} onChange={(e) => setPayer(e.target.value)}>
                {options}
              </select>
            </label>
            {type !== 'expense' ? (
              <label>
                {type === 'loan' ? t('Borrowed by') : t('Received by')}
                <select required value={receiver} onChange={(e) => setReceiver(e.target.value)}>
                  <option value="">{t('Select member')}</option>
                  {options}
                </select>
              </label>
            ) : (
              <label>
                {t('Split method')}
                <select
                  value={method}
                  onChange={(e) => {
                    setMethod(e.target.value as SplitMethod);
                    setValues({});
                  }}
                >
                  <option value="equal">{t('Equally')}</option>
                  <option value="exact">{t('Exact amounts')}</option>
                  <option value="percentage">{t('Percentages')}</option>
                </select>
              </label>
            )}
          </div>
          {type === 'expense' && (
            <fieldset>
              <legend>{t('Split between')}</legend>
              <p className="field-help">
                {t('The payer can be excluded. Remainders are allocated in UID order.')}
              </p>
              {Object.entries(ledger.members).map(([id, m]) => (
                <div className="split-row" key={id}>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={ids.includes(id)}
                      onChange={(e) =>
                        setIds(e.target.checked ? [...ids, id] : ids.filter((x) => x !== id))
                      }
                    />
                    <span className="avatar tiny">{m.name[0]}</span>
                    {m.name}
                  </label>
                  {ids.includes(id) && method !== 'equal' && (
                    <label className="inline-input">
                      <span className="sr-only">
                        {m.name} {method === 'percentage' ? t('percentage') : t('share')}
                      </span>
                      <input
                        inputMode="decimal"
                        aria-label={t(
                          method === 'percentage' ? '{{name}} percentage' : '{{name}} share',
                          { name: m.name },
                        )}
                        placeholder="0"
                        value={values[id] || ''}
                        onChange={(e) => setValues({ ...values, [id]: e.target.value })}
                      />
                      {method === 'percentage' ? '%' : ledger.currency}
                    </label>
                  )}
                  <span className="split-amount">
                    {ids.includes(id) && preview[id] !== undefined
                      ? money(preview[id], ledger.currency)
                      : '—'}
                  </span>
                </div>
              ))}
              {previewError && <p className="field-help">{t(previewError)}</p>}
            </fieldset>
          )}
          {type === 'repayment' && (
            <div className="alert">
              {t(
                'Record money that has actually changed hands. This reduces the payer’s net debt; it does not create an expense. Overpayments can reverse a balance.',
              )}
            </div>
          )}
          <label>
            {t('Notes') + ' '}
            <span className="muted">{t('(optional)')}</span>
            <textarea
              maxLength={2000}
              rows={2}
              value={old && notes === old.notes ? financialText(old, 'notes') : notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          {error && (
            <div role="alert" className="alert error">
              {t(error)}
            </div>
          )}
          <div className="dialog-footer">
            <button type="button" className="secondary" disabled={busy} onClick={onClose}>
              {t('Cancel')}
            </button>
            <button className="primary" disabled={busy}>
              {busy ? t('Saving to server…') : record ? t('Save changes') : t('Save transaction')}
            </button>
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}
