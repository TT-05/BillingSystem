import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, query, where } from 'firebase/firestore';
import type {
  Ledger,
  PaymentEvent,
  PaymentRequest,
  PaymentStatus,
  Settlement,
} from '../domain/types';
import { MAX_AMOUNT, inputMoney, parseMoney } from '../domain/finance';
import { money, number } from '../i18n/format';
import { t } from '../i18n';
import { localizedValidation } from '../i18n/validation';
import { db } from '../services/firebase';
import { errorMessage } from '../services/errors';
import { newPaymentId, requestPayment, resolvePayment } from '../services/payments';
import { useLive } from '../hooks/useLive';
import { dateText } from '../domain/display';
import { Dialog } from './Dialog';
const name = (ledger: Ledger, uid: string) => ledger.members[uid]?.name || t('Former member');
export function PaymentForm({
  ledger,
  transfer,
  uid,
  onClose,
  onSaved,
}: {
  ledger: Ledger;
  transfer: Settlement;
  uid: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  useTranslation();
  const [id] = useState(newPaymentId);
  const [total, setTotal] = useState(() => inputMoney(Math.min(transfer.amount, MAX_AMOUNT)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Dialog title={t("I've Paid")} onClose={onClose} busy={busy}>
      <p>
        {t(
          'Report payment to {{receiver}}. Your balance changes only after they confirm receipt.',
          { receiver: name(ledger, transfer.receiverId) },
        )}
      </p>
      <form
        {...localizedValidation}
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          void (async () => {
            try {
              const amount = parseMoney(total);
              if (amount > transfer.amount)
                throw new Error('The payment cannot exceed the current recommended transfer.');
              await requestPayment(db!, {
                id,
                ledgerId: ledger.id,
                payerId: transfer.payerId,
                receiverId: transfer.receiverId,
                amount,
                actorId: uid,
                expectedLedgerRevision: ledger.revision,
              });
              onSaved();
            } catch (error) {
              setError(errorMessage(error));
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <label>
          {t('Amount')} ({ledger.currency})
          <input
            required
            inputMode="decimal"
            value={total}
            disabled={busy}
            onChange={(e) => setTotal(e.target.value)}
          />
        </label>
        <p className="field-help">
          {t('Recommended maximum: {{amount}}. A partial payment is allowed.', {
            amount: money(transfer.amount, ledger.currency),
          })}
        </p>
        {error && (
          <p className="alert error" role="alert">
            {t(error)}
          </p>
        )}
        <div className="dialog-footer">
          <button type="button" className="secondary" disabled={busy} onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary" disabled={busy}>
            {busy ? t('Saving to server…') : t('Send for confirmation')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function PaymentHistory({
  ledger,
  request,
  onClose,
}: {
  ledger: Ledger;
  request: PaymentRequest;
  onClose: () => void;
}) {
  useTranslation();
  const events = useLive<PaymentEvent>(`payment-history:${ledger.id}:${request.id}`, () =>
    query(
      collection(db!, 'ledgers', ledger.id, 'paymentAudit'),
      where('requestId', '==', request.id),
    ),
  );
  return (
    <Dialog title={t('Payment history')} onClose={onClose}>
      <p>
        {name(ledger, request.payerId)} → {name(ledger, request.receiverId)} ·{' '}
        {money(request.amount, request.currency)}
      </p>
      {events.error ? (
        <p role="alert" className="alert error">
          {t(events.error)}
        </p>
      ) : events.loading ? (
        <p>{t('Loading history…')}</p>
      ) : (
        <ol className="payment-history">
          {[...events.items]
            .sort((a, b) => a.version - b.version)
            .map((event) => (
              <li key={event.id}>
                <strong>{t('payment.' + event.after.status)}</strong>
                <p>
                  {t('By {{actor}}', { actor: name(ledger, event.actorId) })} · {dateText(event.at)}
                </p>
              </li>
            ))}
        </ol>
      )}
      <p className="field-help">
        {t(
          'Requests and responses are permanent audit events. Only confirmed receipt affects balances.',
        )}
      </p>
    </Dialog>
  );
}
export function PaymentPanel({
  ledger,
  uid,
  requests,
  loading,
  error,
  online,
  onNotice,
  onError,
}: {
  ledger: Ledger;
  uid: string;
  requests: PaymentRequest[];
  loading: boolean;
  error: string;
  online: boolean;
  onNotice: (key: string) => void;
  onError: (key: string) => void;
}) {
  useTranslation();
  const [history, setHistory] = useState<PaymentRequest | null>(null);
  const [choice, setChoice] = useState<{
    payment: PaymentRequest;
    status: Exclude<PaymentStatus, 'pending'>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const own = requests
    .filter((p) => p.payerId === uid || p.receiverId === uid)
    .sort(
      (a, b) =>
        Number(b.status === 'pending') - Number(a.status === 'pending') ||
        (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0),
    );
  const pending = own.filter((p) => p.status === 'pending').length;
  function choose(payment: PaymentRequest, status: Exclude<PaymentStatus, 'pending'>) {
    setActionError('');
    setChoice({ payment, status });
  }
  async function finish() {
    if (!choice) return;
    setBusy(true);
    setActionError('');
    try {
      await resolvePayment(db!, ledger.id, choice.payment.id, uid, choice.status);
      onNotice(
        choice.status === 'confirmed'
          ? 'Receipt confirmed. Repayment recorded once.'
          : choice.status === 'rejected'
            ? 'Payment request rejected. Balances are unchanged.'
            : 'Payment request cancelled. Balances are unchanged.',
      );
      setChoice(null);
    } catch (error) {
      setActionError(errorMessage(error));
      onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="panel payment-panel"
      id="payment-confirmations"
      aria-label={t('Payment confirmations')}
    >
      <div className="panel-heading">
        <div>
          <h2>{t('Payment confirmations')}</h2>
          <p>{t('Pending requests do not reduce debt.')}</p>
        </div>
        <span className="pill">{t('{{countText}} pending', { countText: number(pending) })}</span>
      </div>
      {error ? (
        <p role="alert" className="alert error">
          {t(error)}
        </p>
      ) : loading ? (
        <p className="loading">{t('Loading payments…')}</p>
      ) : !own.length ? (
        <p className="payment-empty">
          {t('No payment requests yet. Debtors can select “I’ve Paid” on a recommendation.')}
        </p>
      ) : (
        <div className="payment-list">
          {own.map((p) => {
            const stale = p.status === 'pending' && p.ledgerRevision !== ledger.revision;
            const active =
              ledger.memberIds.includes(p.payerId) && ledger.memberIds.includes(p.receiverId);
            return (
              <article className="payment-request" key={p.id} data-status={p.status}>
                <div>
                  <strong>
                    {name(ledger, p.payerId)} → {name(ledger, p.receiverId)}
                  </strong>
                  <p>
                    {money(p.amount, p.currency)} · {dateText(p.createdAt)}
                  </p>
                  <span className={'payment-status ' + p.status}>{t('payment.' + p.status)}</span>
                  {stale && (
                    <p className="field-help">
                      {t(
                        'Balances changed. Cancel or reject this request and review the current settlement plan.',
                      )}
                    </p>
                  )}
                  {!active && p.status === 'pending' && (
                    <p className="field-help">
                      {t('Both payment participants must be active ledger members.')}
                    </p>
                  )}
                </div>
                <div className="payment-actions">
                  <button className="text-link" onClick={() => setHistory(p)}>
                    {t('Payment history')}
                  </button>
                  {p.status === 'pending' && p.receiverId === uid && (
                    <>
                      <button
                        className="primary small"
                        disabled={!online || busy || stale || !active}
                        onClick={() => choose(p, 'confirmed')}
                      >
                        {t('Confirm Receipt')}
                      </button>
                      <button
                        className="secondary small"
                        disabled={!online || busy}
                        onClick={() => choose(p, 'rejected')}
                      >
                        {t('Reject')}
                      </button>
                    </>
                  )}
                  {p.status === 'pending' && p.payerId === uid && (
                    <button
                      className="secondary small"
                      disabled={!online || busy}
                      onClick={() => choose(p, 'cancelled')}
                    >
                      {t('Cancel request')}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {history && (
        <PaymentHistory ledger={ledger} request={history} onClose={() => setHistory(null)} />
      )}
      {choice && (
        <Dialog
          title={t(
            choice.status === 'confirmed'
              ? 'Confirm Receipt'
              : choice.status === 'rejected'
                ? 'Reject payment request?'
                : 'Cancel payment request?',
          )}
          busy={busy}
          onClose={() => setChoice(null)}
        >
          <p>
            {choice.status === 'confirmed'
              ? t(
                  'Confirm you received {{amount}} from {{payer}}. This records a repayment and changes balances.',
                  {
                    amount: money(choice.payment.amount, choice.payment.currency),
                    payer: name(ledger, choice.payment.payerId),
                  },
                )
              : t('This closes the request without changing any balance.')}
          </p>
          {actionError && (
            <p className="alert error" role="alert">
              {t(actionError)}
            </p>
          )}
          <div className="dialog-footer">
            <button className="secondary" disabled={busy} onClick={() => setChoice(null)}>
              {t('Close')}
            </button>
            <button className="primary" disabled={busy || !online} onClick={() => void finish()}>
              {busy ? t('Saving to server…') : t('Confirm')}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
