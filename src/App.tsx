import { PaymentForm, PaymentPanel } from './components/Payments';
import { settlementSummary } from './domain/settlementSummary';
import { money, number, percent, ledgerDate, financialText } from './i18n/format';
import { LanguageSelector } from './components/LanguageSelector';
import { useTranslation } from 'react-i18next';
import { t } from './i18n';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { onAuthStateChanged, reload, sendEmailVerification, signOut } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  History,
  Layers3,
  LayoutDashboard,
  LogOut,
  Plus,
  Receipt,
  Search,
  Settings,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import {
  auth,
  authRedirectReady,
  configurationError,
  db,
  usingEmulators,
} from './services/firebase';
import { leaveLedger, writeFinancial } from './services/ledger';
import { errorMessage } from './services/errors';
import { balances, changedFields, settlements } from './domain/finance';
import type {
  AuditEvent,
  FinancialData,
  FinancialRecord,
  Kind,
  Ledger,
  PaymentRequest,
  Settlement,
} from './domain/types';
import { AuthScreen } from './components/Auth';
import { Dialog } from './components/Dialog';
import { RecordForm } from './components/RecordForm';
import { Avatar } from './components/Avatar';
import { LedgerForm } from './components/LedgerForm';
import { Profile } from './components/Profile';
import { InvitationDialog } from './components/InvitationDialog';
import { GroupSettings } from './components/GroupSettings';
import { dateText } from './domain/display';
import { useLive } from './hooks/useLive';
import { initializeGoogleProfile } from './services/googleAuth';
import { strings } from './strings';
type Page = keyof typeof strings.nav;
function Empty({ title, children }: { title: string; children: ReactNode }) {
  useTranslation();
  return (
    <div className="empty">
      <div className="empty-icon">
        <Layers3 size={26} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function nameOf(l: Ledger, id: string) {
  return l.members[id]?.name || t('Former member');
}
function AppContent({ user }: { user: User }) {
  useTranslation();
  const ledgerState = useLive<Ledger>(`ledgers:${user.uid}`, () =>
    query(collection(db!, 'ledgers'), where('memberIds', 'array-contains', user.uid)),
  );
  const [selected, setSelected] = useState(
    () => localStorage.getItem('settle-ledger:' + user.uid) || '',
  );
  const [page, setPage] = useState<Page>('dashboard');
  const ledger = ledgerState.items.find((l) => l.id === selected) || ledgerState.items[0];
  const lid = ledger?.id || '';
  const recordsState = useLive<FinancialRecord>(lid ? `records:${lid}` : '', () =>
    lid ? collection(db!, 'ledgers', lid, 'records') : null,
  );
  const paymentState = useLive<PaymentRequest>(lid ? `payments:${lid}` : '', () =>
    lid ? collection(db!, 'ledgers', lid, 'payments') : null,
  );
  const [payment, setPayment] = useState<Settlement | null>(null);
  const [historyLimit, setHistoryLimit] = useState(100);
  const auditState = useLive<AuditEvent>(lid ? `audit:${lid}:${number(historyLimit)}` : '', () =>
    lid
      ? query(collection(db!, 'ledgers', lid, 'audit'), orderBy('at', 'desc'), limit(historyLimit))
      : null,
  );
  const [online, setOnline] = useState(navigator.onLine);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [newLedger, setNewLedger] = useState(false);
  const [profile, setProfile] = useState(false);
  const [form, setForm] = useState<{ kind: Kind; record?: FinancialRecord } | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    body: string | (() => string);
    run: () => Promise<void>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteToken, setInviteToken] = useState(
    () => new URLSearchParams(window.location.search).get('invite') || '',
  );
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('active');
  const [sort, setSort] = useState('newest');
  useEffect(() => {
    const yes = () => setOnline(true),
      no = () => setOnline(false);
    window.addEventListener('online', yes);
    window.addEventListener('offline', no);
    return () => {
      window.removeEventListener('online', yes);
      window.removeEventListener('offline', no);
    };
  }, []);
  const selectLedger = (id: string) => {
    setSelected(id);
    localStorage.setItem('settle-ledger:' + user.uid, id);
    setDetail(null);
    setForm(null);
    setPayment(null);
    setHistoryLimit(100);
    setSearch('');
    setFilter('active');
    setError('');
  };
  const records = recordsState.items;
  let net: Record<string, number> = {};
  let plan: Settlement[] = [];
  let calculationError = '';
  if (ledger)
    try {
      net = balances(records, Object.keys(ledger.members));
      plan = settlements(net);
    } catch (e) {
      calculationError = errorMessage(e);
    }
  const loading = ledgerState.loading || (!!lid && recordsState.loading);
  const active = records.filter((r) => !r.data.deleted);
  const expenses = active.filter((r) => r.data.kind === 'expense');
  const spending = expenses.reduce((n, r) => n + r.data.amount, 0);
  const recent = [...records]
    .filter((r) => !r.data.deleted)
    .sort((a, b) => b.data.date.localeCompare(a.data.date) || b.id.localeCompare(a.id));
  const filtered = records
    .filter(
      (r) =>
        (filter === 'deleted'
          ? r.data.deleted
          : !r.data.deleted && (filter === 'active' || r.data.kind === filter)) &&
        `${financialText(r.data, 'description')} ${r.data.notes} ${ledger ? nameOf(ledger, r.data.payerId) : ''}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === 'amount'
        ? b.data.amount - a.data.amount
        : sort === 'oldest'
          ? a.data.date.localeCompare(b.data.date)
          : b.data.date.localeCompare(a.data.date),
    );
  const detailRecord = records.find((r) => r.id === detail);
  const notify = (s: string) => {
    setNotice(s);
    setError('');
  };
  async function action(fn: () => Promise<void>, success: string) {
    setBusy(true);
    setError('');
    try {
      await fn();
      setConfirm(null);
      notify(success);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function remove(r: FinancialRecord) {
    setConfirm({
      title: 'Move transaction to deleted?',
      body: 'This removes its effect on balances. Its history stays intact, and you can restore it later.',
      run: () =>
        writeFinancial(db!, {
          ledgerId: lid,
          id: r.id,
          data: { ...r.data, deleted: true },
          actorId: user.uid,
          expectedVersion: r.version,
          action: 'delete',
        }),
    });
  }
  function restore(r: FinancialRecord, data: FinancialData) {
    setConfirm({
      title: 'Restore this version?',
      body: 'This creates a new audited version and recalculates balances for everyone. Later repayments remain unchanged.',
      run: () =>
        writeFinancial(db!, {
          ledgerId: lid,
          id: r.id,
          data: { ...data, deleted: false },
          actorId: user.uid,
          expectedVersion: r.version,
          action: 'restore',
        }),
    });
  }
  const summary = settlementSummary(plan, user.uid);
  const renderTable = (rows: FinancialRecord[], compact = false) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{t('Transaction')}</th>
            <th>{t('Date')}</th>
            <th>{t('Paid by')}</th>
            <th className="right">{t('Amount')}</th>
            <th>
              <span className="sr-only">{t('View')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.data.deleted ? 'deleted-row' : ''}>
              <td>
                <button className="transaction-button" onClick={() => setDetail(r.id)}>
                  <span className={`transaction-icon ${r.data.kind}`}>
                    {r.data.kind === 'expense' ? (
                      <Receipt size={18} />
                    ) : r.data.kind === 'loan' ? (
                      <ArrowUpRight size={18} />
                    ) : (
                      <ArrowDownLeft size={18} />
                    )}
                  </span>
                  <span>
                    <strong>{financialText(r.data, 'description')}</strong>
                    <small>
                      {r.data.deleted ? t('Deleted ·') + ' ' : ''}
                      {r.data.kind === 'expense'
                        ? t('{{value0}} people · {{value1}} split', {
                            value0: number(r.data.participants.length),
                            value1: t(r.data.splitMethod),
                          })
                        : r.data.kind === 'loan'
                          ? t('Loan to {{value0}}', { value0: nameOf(ledger!, r.data.receiverId) })
                          : t('Repayment to {{value0}}', {
                              value0: nameOf(ledger!, r.data.receiverId),
                            })}
                    </small>
                  </span>
                </button>
              </td>
              <td className="date-cell">{ledgerDate(r.data.date)}</td>
              <td>
                <span className="person-inline">
                  <Avatar name={nameOf(ledger!, r.data.payerId)} small />
                  {nameOf(ledger!, r.data.payerId)}
                </span>
              </td>
              <td className="right amount">{money(r.data.amount, ledger!.currency)}</td>
              <td>
                <button
                  className="icon-button"
                  aria-label={t('View {{value0}}', {
                    value0: financialText(r.data, 'description'),
                  })}
                  onClick={() => setDetail(r.id)}
                >
                  <ArrowUpRight size={17} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <Empty
          title={compact ? t('Your first shared moment starts here.') : t('No transactions found.')}
        >
          {compact
            ? t('Add an expense and we’ll take care of the split.')
            : t('Try another filter, or add your first transaction.')}
        </Empty>
      )}
    </div>
  );
  const renderPlan = (compact = false) => (
    <>
      {plan.length ? (
        plan.slice(0, compact ? 3 : undefined).map((s) => (
          <div className="settlement-row" key={s.payerId + s.receiverId}>
            <div className="transfer-avatars">
              <Avatar name={nameOf(ledger!, s.payerId)} small />
              <ArrowRight size={14} />
              <Avatar name={nameOf(ledger!, s.receiverId)} small />
            </div>
            <div className="transfer-text">
              <strong>
                {nameOf(ledger!, s.payerId)} <span className="muted">{t('pays')}</span>{' '}
                {nameOf(ledger!, s.receiverId)}
              </strong>
              <small>
                {compact ? t('Suggested transfer') : t('Recommendation · not yet paid')}
              </small>
            </div>
            <strong className="amount">{money(s.amount, ledger!.currency)}</strong>
            {!compact && s.payerId === user.uid && (
              <button
                className="secondary small"
                disabled={
                  !online ||
                  busy ||
                  paymentState.loading ||
                  paymentState.cached ||
                  !!paymentState.error ||
                  !ledger!.memberIds.includes(s.receiverId) ||
                  paymentState.items.some(
                    (p) =>
                      p.status === 'pending' &&
                      p.payerId === s.payerId &&
                      p.receiverId === s.receiverId,
                  )
                }
                onClick={() => setPayment(s)}
              >
                {t("I've Paid")}
              </button>
            )}
          </div>
        ))
      ) : (
        <div className="all-settled">
          <CheckCircle2 size={30} />
          <h3>{t('All square.')}</h3>
          <p>{t('No transfers needed. That’s a good feeling.')}</p>
        </div>
      )}
      {compact && plan.length > 0 && (
        <button className="text-link" onClick={() => setPage('balances')}>
          {t('View settlement plan') + ' '}
          <ArrowRight size={15} />
        </button>
      )}
    </>
  );
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            setPage('dashboard');
          }}
        >
          <span className="brand-symbol">
            <Layers3 size={23} />
          </span>
          settle<span className="brand-dot">.</span>
        </a>
        <div className="ledger-switch">
          <label className="eyebrow" htmlFor="ledger-picker">
            {t('YOUR SHARED SPACE')}
          </label>
          <div className="ledger-select">
            <span className="ledger-mini">
              <Users size={18} />
            </span>
            <select
              id="ledger-picker"
              aria-label={t('Selected ledger')}
              value={lid}
              onChange={(e) => selectLedger(e.target.value)}
            >
              {!ledger && <option value="">{t('No ledgers yet')}</option>}
              {ledgerState.items.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </div>
          <button className="new-group" onClick={() => setNewLedger(true)}>
            <Plus size={14} /> {' ' + t('Create a ledger')}
          </button>
        </div>
        <nav aria-label={t('Main navigation')}>
          {(Object.keys(strings.nav) as Page[]).map((p) => {
            const Icon = {
              dashboard: LayoutDashboard,
              expenses: Receipt,
              balances: Wallet,
              activity: History,
              settings: Settings,
            }[p];
            return (
              <button
                key={p}
                aria-current={page === p ? 'page' : undefined}
                className={page === p ? 'nav-item active' : 'nav-item'}
                onClick={() => setPage(p)}
              >
                <Icon size={19} />
                {t(strings.nav[p])}
                {p === 'expenses' && expenses.length > 0 && (
                  <span className="nav-count" aria-hidden="true">
                    {number(expenses.length)}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-note">
            <span className="privacy-dot" />
            {t('Just between your people.')}
            <small>{t('Private by design. Clear by nature.')}</small>
          </div>
          <button
            className="profile-button"
            aria-label={t('{{name}} Account & profile', {
              name: user.displayName || t('Your account'),
            })}
            onClick={() => setProfile(true)}
          >
            <Avatar name={user.displayName || t('You')} />
            <span>
              <strong>{user.displayName || t('Your account')}</strong>
              <small>{t('Account & profile')}</small>
            </span>
            <Settings size={16} />
          </button>
          <button
            className="logout"
            onClick={() => void signOut(auth!).catch((e) => setError(errorMessage(e)))}
          >
            <LogOut size={15} /> {' ' + t('Sign out')}
          </button>
        </div>
      </aside>
      <div className="main-layout">
        <header className="topbar">
          <div className="breadcrumbs">
            {t('Your ledgers') + ' '}
            <span>/</span> <strong>{ledger?.name || t('Getting started')}</strong>
          </div>
          <div className="topbar-meta">
            <LanguageSelector />
            <span className={`connection ${!online || recordsState.cached ? 'offline' : ''}`}>
              <i />
              {!online
                ? t('Offline · changes not saved')
                : recordsState.cached && lid
                  ? t('Connecting…')
                  : t('Live updates')}
            </span>
            {ledger && <span className="currency-chip">{ledger.currency}</span>}
          </div>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {page === 'dashboard' ? t('THE BIG PICTURE') : t(strings.nav[page]).toUpperCase()}
              </span>
              <h1>{t(strings.headings[page])}</h1>
              <p className="muted">
                {page === 'dashboard'
                  ? ledger
                    ? t('Here’s where things stand in {{ledger}}.', { ledger: ledger.name })
                    : t('Here’s where things stand.')
                  : page === 'expenses'
                    ? t('The little things add up. Keep them all in one place.')
                    : page === 'balances'
                      ? t('Fewer transfers. A fresh start for everyone.')
                      : page === 'activity'
                        ? t('A shared record you can always come back to.')
                        : t('A few details that keep everyone on the same page.')}
              </p>
            </div>
            {ledger && page !== 'settings' && (
              <button
                className="primary"
                disabled={!online || loading || !!calculationError || !!recordsState.error}
                onClick={() =>
                  page === 'balances'
                    ? document
                        .getElementById('payment-confirmations')
                        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    : setForm({ kind: 'expense' })
                }
              >
                <Plus size={18} />
                {page === 'balances' ? t('Review payments') : t('Add expense')}
              </button>
            )}
          </div>
          {usingEmulators && (
            <div className="emulator-strip">
              {t('LOCAL EMULATOR · isolated test data · no production Firebase connection')}
            </div>
          )}
          {!user.emailVerified && (
            <div className="verification-note">
              <span>{t('Verify your email to accept invitations.')}</span>
              <button
                onClick={() =>
                  void action(
                    () => sendEmailVerification(user),
                    'Verification email sent. Check your inbox.',
                  )
                }
              >
                {t('Send verification email')}
              </button>
              <button
                onClick={() =>
                  void action(async () => {
                    await reload(user);
                    await user.getIdToken(true);
                    if (!user.emailVerified)
                      throw new Error(
                        'Email is not verified yet. Open the link in your inbox first.',
                      );
                  }, 'Email verified. You can now accept invitations.')
                }
              >
                {t('Refresh verification')}
              </button>
            </div>
          )}
          {notice && (
            <div className="alert success toast" role="status">
              <Check size={17} />
              {t(notice)}
              <button aria-label={t('Dismiss notification')} onClick={() => setNotice('')}>
                <X size={15} />
              </button>
            </div>
          )}
          {(error || ledgerState.error || recordsState.error || calculationError) && (
            <div className="alert error" role="alert">
              {t(error || ledgerState.error || recordsState.error || calculationError || '')}
            </div>
          )}
          {loading ? (
            <div className="loading">
              <span className="spinner" />
              {online
                ? t('Getting your ledger ready…')
                : t('Offline — reconnect to load your ledger.')}
            </div>
          ) : recordsState.error || calculationError ? (
            <Empty title={t('Ledger data is unavailable.')}>
              <span>{t('Reconnect to load verified balances.')}</span>
              <br />
              <button className="secondary" onClick={() => window.location.reload()}>
                {t('Reconnect')}
              </button>
            </Empty>
          ) : !ledger ? (
            <section className="welcome-card">
              <div className="welcome-art">
                <Layers3 size={66} />
              </div>
              <span className="eyebrow">{t('A CLEAN SLATE')}</span>
              <h2>{t('Sharing starts with a space.')}</h2>
              <p>
                {t('Create a ledger for your roommates, your next trip,')}
                <br />
                {t('or simply the people you split things with.')}
              </p>
              <button className="primary" onClick={() => setNewLedger(true)}>
                <Plus size={18} />
                {t('Create your first ledger')}
              </button>
              <p className="field-help">
                {t('Have an invitation? Open the link your friend shared with you.')}
              </p>
            </section>
          ) : (
            <>
              {page === 'dashboard' && (
                <>
                  <section className="summary-grid payment-summary-grid">
                    {(['receivables', 'payables'] as const).map((kind) => (
                      <div
                        className={'personal-card debt-summary ' + kind}
                        data-testid={kind}
                        key={kind}
                      >
                        <div className="card-top">
                          <span>{t(kind === 'receivables' ? 'Receivables' : 'Payables')}</span>
                          <ArrowUpRight size={20} />
                        </div>
                        <div className="big-amount">
                          {money(summary[kind].amount, ledger.currency)}
                          <span>{ledger.currency}</span>
                        </div>
                        <p>
                          {t('{{countText}} outstanding payments', {
                            countText: number(summary[kind].count),
                            count: summary[kind].count,
                          })}
                        </p>
                        <div className="personal-footer">
                          {t(
                            summary[kind].count === 0
                              ? 'No outstanding recommended transfers.'
                              : 'Based on current net settlement recommendations.',
                          )}
                        </div>
                      </div>
                    ))}
                    <div className="stat-card">
                      <span className="stat-icon">
                        <Receipt size={21} />
                      </span>
                      <span className="eyebrow">{t('TOTAL SHARED SPENDING')}</span>
                      <strong>{money(spending, ledger.currency)}</strong>
                      <p>
                        {t('Across {{countText}} shared expenses', {
                          countText: number(expenses.length),
                        })}
                      </p>
                      <span className="stat-foot">
                        {t('All time ·') + ' '}
                        {ledger.currency}
                      </span>
                    </div>
                    <div className="stat-card">
                      <span className="stat-icon peach">
                        <Users size={21} />
                      </span>
                      <span className="eyebrow">{t('IN THIS TOGETHER')}</span>
                      <strong>
                        {number(ledger.memberIds.length)}{' '}
                        <span className="unit">
                          {ledger.memberIds.length === 1 ? t('member') : t('members')}
                        </span>
                      </strong>
                      <div className="avatar-stack">
                        {ledger.memberIds.map((id) => (
                          <Avatar key={id} name={nameOf(ledger, id)} small />
                        ))}
                      </div>
                      <button className="text-link stat-foot" onClick={() => setPage('settings')}>
                        {t('Meet your group') + ' '}
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  </section>
                  <div className="dashboard-columns">
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h2>{t('Recent activity')}</h2>
                          <p>{t('The latest things you’ve shared.')}</p>
                        </div>
                        <button className="text-link" onClick={() => setPage('expenses')}>
                          {t('View all') + ' '}
                          <ArrowRight size={15} />
                        </button>
                      </div>
                      {renderTable(recent.slice(0, 5), true)}
                    </section>
                    <section className="panel settlement-panel">
                      <div className="panel-heading">
                        <div>
                          <span className="eyebrow">{t('THE WAY TO EVEN')}</span>
                          <h2>{t('Settle with ease.')}</h2>
                          <p>{t('A simpler plan for your group.')}</p>
                        </div>
                      </div>
                      {renderPlan(true)}
                      <div className="plan-note">
                        <CircleHelp size={15} />
                        <span>
                          {t(
                            'Suggestions only. Confirm a payment after money actually changes hands.',
                          )}
                        </span>
                      </div>
                    </section>
                  </div>
                  <div className="bottom-note">
                    <Layers3 size={17} />
                    <span>{t('Less keeping score. More making memories.')}</span>
                    <span className="reconciled">
                      <CheckCircle2 size={14} />
                      {t('Balances reconcile to zero')}
                    </span>
                  </div>
                </>
              )}
              {page === 'expenses' && (
                <section className="panel">
                  <div className="list-toolbar">
                    <div className="search-box">
                      <Search size={17} />
                      <input
                        aria-label={t('Search transactions')}
                        placeholder={t('Search expenses, people, notes…')}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                    <select
                      aria-label={t('Filter transactions')}
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="active">{t('All active transactions')}</option>
                      <option value="expense">{t('Expenses')}</option>
                      <option value="loan">{t('Direct loans')}</option>
                      <option value="repayment">{t('Repayments')}</option>
                      <option value="deleted">{t('Deleted transactions')}</option>
                    </select>
                    <select
                      aria-label={t('Sort transactions')}
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                    >
                      <option value="newest">{t('Newest first')}</option>
                      <option value="oldest">{t('Oldest first')}</option>
                      <option value="amount">{t('Highest amount')}</option>
                    </select>
                  </div>
                  {renderTable(filtered)}
                </section>
              )}
              {page === 'balances' && (
                <>
                  <div className="balance-layout">
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h2>{t('Where everyone stands')}</h2>
                          <p>{t('Positive means owed. Negative means owing.')}</p>
                        </div>
                        <span className="pill">{ledger.currency}</span>
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
                                  ? t('Former member · balance retained')
                                  : id === ledger.ownerId
                                    ? t('Ledger owner')
                                    : t('Member')}
                              </small>
                            </div>
                            <span
                              className={`balance-number ${(net[id] || 0) > 0 ? 'positive' : (net[id] || 0) < 0 ? 'negative' : ''}`}
                            >
                              {(net[id] || 0) > 0 ? '+' : ''}
                              {money(net[id] || 0, ledger.currency)}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="reconcile-bar">
                        <CheckCircle2 size={16} />
                        {t('Group total')}{' '}
                        <strong>
                          {money(
                            Object.values(net).reduce((a, b) => a + b, 0),
                            ledger.currency,
                          )}
                        </strong>
                      </div>
                    </section>
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h2>{t('Suggested settlements')}</h2>
                          <p>{t('Deterministic netting. Fewer unnecessary transfers.')}</p>
                        </div>
                      </div>
                      {renderPlan()}
                      <div className="plan-note">
                        <CircleHelp size={15} />
                        <span>
                          {t(
                            'Largest balances first. This greedy plan is valid, but may not use the absolute fewest transfers. Repayments are separate financial records.',
                          )}
                        </span>
                      </div>
                    </section>
                  </div>
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>{t('Loans & repayments')}</h2>
                        <p>{t('Actual movements of money, kept separate from expenses.')}</p>
                      </div>
                      <button className="secondary" onClick={() => setForm({ kind: 'loan' })}>
                        <Plus size={16} />
                        {t('Record loan')}
                      </button>
                    </div>
                    {renderTable(recent.filter((r) => r.data.kind !== 'expense'))}
                  </section>
                </>
              )}
              {(page === 'dashboard' || page === 'balances') && (
                <PaymentPanel
                  key={ledger.id}
                  ledger={ledger}
                  uid={user.uid}
                  requests={paymentState.items}
                  loading={paymentState.loading}
                  error={paymentState.error}
                  online={online && !paymentState.cached}
                  onNotice={notify}
                  onError={setError}
                />
              )}
              {page === 'activity' && (
                <section className="panel activity-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>{t('Ledger history')}</h2>
                      <p>{t('Immutable versions. Server timestamps. A clear paper trail.')}</p>
                    </div>
                    <span className="pill">
                      <Clock3 size={14} /> {' ' + t('Latest') + ' '}
                      {number(historyLimit)}
                    </span>
                  </div>
                  {auditState.error && <div className="alert error">{t(auditState.error)}</div>}
                  {auditState.loading ? (
                    <div className="loading">{t('Loading history…')}</div>
                  ) : !auditState.items.length ? (
                    <Empty title={t('A story waiting to be written.')}>
                      {t('Every financial change will appear here.')}
                    </Empty>
                  ) : (
                    <div className="timeline">
                      {auditState.items.map((a) => {
                        const current = records.find((r) => r.id === a.recordId);
                        return (
                          <article className="timeline-event" key={a.id}>
                            <div className="timeline-icon">
                              <History size={16} />
                            </div>
                            <div className="timeline-content">
                              <div className="timeline-head">
                                <strong>
                                  {nameOf(ledger, a.actorId)}{' '}
                                  <span className="muted">{t('audit.' + a.action)}</span>{' '}
                                  <button
                                    className="inline-link"
                                    onClick={() => setDetail(a.recordId)}
                                  >
                                    {financialText(a.after, 'description')}
                                  </button>
                                </strong>
                                <time>{dateText(a.at)}</time>
                              </div>
                              <div className="diff-list">
                                {changedFields(a.before, a.after).map((field) => (
                                  <div className="diff-row" key={field}>
                                    <span>{t('field.' + field)}</span>
                                    {a.before && (
                                      <>
                                        <del>{displayValue(field, a.before, ledger)}</del>
                                        <ArrowRight size={12} />
                                      </>
                                    )}
                                    <span>{displayValue(field, a.after, ledger)}</span>
                                  </div>
                                ))}
                              </div>
                              <div className="event-foot">
                                {t('Version') + ' '}
                                {number(a.version)} · {t(a.after.kind)}
                                {current &&
                                  current.data.kind !== 'repayment' &&
                                  a.version !== current.version && (
                                    <button
                                      className="text-link"
                                      onClick={() => restore(current, a.after)}
                                    >
                                      {t('Restore this version')}
                                    </button>
                                  )}
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                  {auditState.items.length === historyLimit && (
                    <div className="panel-footer">
                      <button className="secondary" onClick={() => setHistoryLimit((n) => n + 100)}>
                        {t('Load older history')}
                      </button>
                    </div>
                  )}
                </section>
              )}
              {page === 'settings' && (
                <GroupSettings
                  key={ledger.id}
                  ledger={ledger}
                  user={user}
                  onError={setError}
                  onNotice={notify}
                  onLeave={() =>
                    setConfirm({
                      title: 'Leave this ledger?',
                      body: () =>
                        t(
                          'You’ll lose access to this ledger. Your transaction history and {{balance}} balance remain for the other members; leaving does not forgive debt. Ask the owner for a new invitation if you need to return.',
                          { balance: money(net[user.uid] || 0, ledger.currency) },
                        ),
                      run: async () => {
                        await leaveLedger(db!, lid, user.uid);
                        selectLedger('');
                      },
                    })
                  }
                />
              )}
            </>
          )}
        </main>
        <footer className="main-footer">
          <span>
            {t('settle.') + ' '}
            <span className="muted">{t('A little clarity, together.')}</span>
          </span>
          <span>{t('Private ledgers · No payment processing')}</span>
        </footer>
      </div>
      {newLedger && (
        <LedgerForm
          uid={user.uid}
          user={user}
          onClose={() => setNewLedger(false)}
          onSaved={(id) => {
            setNewLedger(false);
            selectLedger(id);
            setPage('dashboard');
            notify('Your ledger is ready. Invite your people to get started.');
          }}
        />
      )}
      {profile && (
        <Profile
          user={user}
          onClose={() => setProfile(false)}
          onSaved={() => {
            setProfile(false);
            notify('Profile updated. Existing ledgers keep the name captured when you joined.');
          }}
        />
      )}
      {form && ledger && (
        <RecordForm
          key={lid + (form.record?.id || 'new')}
          ledger={ledger}
          uid={user.uid}
          record={form.record}
          kind={form.kind}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            notify('Transaction saved and synchronized.');
          }}
        />
      )}
      {detailRecord && ledger && !form && (
        <Dialog
          title={financialText(detailRecord.data, 'description')}
          onClose={() => setDetail(null)}
        >
          <div className="record-detail">
            <span className="pill">
              {t(detailRecord.data.kind)} {' ' + t('· Version') + ' '}
              {number(detailRecord.version)}
              {detailRecord.data.deleted ? ' ' + t('· Deleted') : ''}
            </span>
            <div className="detail-amount">
              {money(detailRecord.data.amount, ledger.currency)} <small>{ledger.currency}</small>
            </div>
            <p>
              {t(detailRecord.data.kind === 'loan' ? 'Lent by {{payer}}' : 'Paid by {{payer}}', {
                payer: nameOf(ledger, detailRecord.data.payerId),
              })}
              {detailRecord.data.receiverId
                ? t(' to {{receiver}}', { receiver: nameOf(ledger, detailRecord.data.receiverId) })
                : ''}
              {t(' on {{date}}', { date: ledgerDate(detailRecord.data.date) })}
            </p>
            {detailRecord.data.participants.length > 0 && (
              <div className="detail-splits">
                {detailRecord.data.participants.map((id) => (
                  <div key={id}>
                    <span className="person-inline">
                      <Avatar small name={nameOf(ledger, id)} />
                      {nameOf(ledger, id)}
                    </span>
                    <strong>{money(detailRecord.data.shares[id], ledger.currency)}</strong>
                  </div>
                ))}
              </div>
            )}
            {detailRecord.data.notes && (
              <p className="notes">{financialText(detailRecord.data, 'notes')}</p>
            )}
            <p className="field-help">
              {t('Created by') + ' '}
              {nameOf(ledger, detailRecord.createdBy)} · {dateText(detailRecord.createdAt)}
              <br />
              {t('Last changed by') + ' '}
              {nameOf(ledger, detailRecord.updatedBy)} · {dateText(detailRecord.updatedAt)}
            </p>
            <div className="dialog-footer">
              <button
                className="text-link"
                onClick={() => {
                  setDetail(null);
                  setPage('activity');
                }}
              >
                {t('View history') + ' '}
                <ArrowRight size={14} />
              </button>
              {detailRecord.data.kind === 'repayment' ? (
                <p className="field-help">
                  {t('Confirmed repayments are read-only. Their history is preserved.')}
                </p>
              ) : detailRecord.data.deleted ? (
                <button
                  className="primary"
                  onClick={() => restore(detailRecord, detailRecord.data)}
                >
                  {t('Restore transaction')}
                </button>
              ) : (
                <>
                  <button className="danger-text" onClick={() => remove(detailRecord)}>
                    {t('Delete')}
                  </button>
                  <button
                    className="primary"
                    onClick={() => setForm({ kind: detailRecord.data.kind, record: detailRecord })}
                  >
                    {t('Edit transaction')}
                  </button>
                </>
              )}
            </div>
          </div>
        </Dialog>
      )}
      {payment && ledger && (
        <PaymentForm
          key={ledger.id + payment.payerId + payment.receiverId}
          ledger={ledger}
          transfer={payment}
          uid={user.uid}
          onClose={() => setPayment(null)}
          onSaved={() => {
            setPayment(null);
            notify('Payment reported. Waiting for the recipient to confirm receipt.');
          }}
        />
      )}
      {confirm && (
        <Dialog title={t(confirm.title)} onClose={() => setConfirm(null)} busy={busy}>
          <p className="confirm-body">
            {typeof confirm.body === 'function' ? confirm.body() : t(confirm.body)}
          </p>
          {error && (
            <div className="alert error" role="alert">
              {t(error)}
            </div>
          )}
          <div className="dialog-footer">
            <button className="secondary" disabled={busy} onClick={() => setConfirm(null)}>
              {t('Cancel')}
            </button>
            <button
              className="primary"
              disabled={busy || !online}
              onClick={() => void action(confirm.run, 'Change saved and synchronized.')}
            >
              {busy ? t('Saving to server…') : t('Confirm')}
            </button>
          </div>
        </Dialog>
      )}
      {inviteToken && (
        <InvitationDialog
          token={inviteToken}
          user={user}
          onClose={() => {
            setInviteToken('');
            window.history.replaceState({}, '', window.location.pathname);
          }}
          onJoined={(id) => {
            setInviteToken('');
            window.history.replaceState({}, '', window.location.pathname);
            selectLedger(id);
            notify('You joined the ledger. Welcome in.');
          }}
        />
      )}
    </div>
  );
}
function displayValue(field: string, d: FinancialData, ledger: Ledger): string {
  const value = d[field as keyof FinancialData];
  if (field === 'amount') return money(d.amount, ledger.currency);
  if (field === 'payerId' || field === 'receiverId')
    return value ? nameOf(ledger, String(value)) : '—';
  if (field === 'participants') return d.participants.map((id) => nameOf(ledger, id)).join(', ');
  if (field === 'shares')
    return Object.entries(d.shares)
      .map(([id, n]) => `${nameOf(ledger, id)}: ${money(n, ledger.currency)}`)
      .join(', ');
  if (field === 'weights')
    return Object.entries(d.weights)
      .map(
        ([id, n]) =>
          `${nameOf(ledger, id)}: ${d.splitMethod === 'percentage' ? percent(n) : d.splitMethod === 'exact' ? money(n, ledger.currency) : number(n)}`,
      )
      .join(', ');
  if (field === 'description' || field === 'notes') return financialText(d, field);
  if (field === 'date') return ledgerDate(d.date);
  if (field === 'kind' || field === 'splitMethod') return t(String(value));
  return typeof value === 'boolean' ? t(value ? 'Yes' : 'No') : String(value || '—');
}
export function App() {
  useTranslation();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState('');
  const [redirectError, setRedirectError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!auth || !db) {
      setLoading(false);
      return;
    }
    let generation = 0;
    let stop: (() => void) | undefined;
    let mounted = true;
    void authRedirectReady.then((problem) => {
      if (!mounted) return;
      setRedirectError(problem || '');
      stop = onAuthStateChanged(auth!, (u) => {
        const current = ++generation;
        setProfileError('');
        setLoading(true);
        setUser(null);
        if (!u) {
          setLoading(false);
          return;
        }
        // Wait for the Google profile before exposing any ledger UI. Failures stay
        // visible here even when signInWithPopup has already authenticated the user.
        void initializeGoogleProfile(db!, u)
          .then(() => {
            if (current === generation) {
              setUser(u);
              setLoading(false);
            }
          })
          .catch((e) => {
            if (current === generation) {
              setProfileError(errorMessage(e));
              setLoading(false);
            }
          });
      });
    });
    return () => {
      mounted = false;
      generation++;
      stop?.();
    };
  }, [retry]);
  if (configurationError)
    return (
      <div className="configuration">
        <LanguageSelector />
        <Layers3 size={40} />
        <h1>{t('Let’s connect your shared space.')}</h1>
        <p>{t(configurationError)}</p>
        <code>{t('VITE_USE_EMULATORS=true npm run dev')}</code>
        <p>
          {t('Start Firebase emulators in another terminal with') + ' '}
          <code>{t('npm run emulators')}</code>.
        </p>
      </div>
    );
  if (profileError)
    return (
      <main className="configuration">
        <LanguageSelector />
        <h1>{t('We couldn’t load your profile.')}</h1>
        <div className="alert error" role="alert">
          {t(profileError)}
        </div>
        <p>
          {t('Your sign-in completed, but your profile has not synchronized. Reconnect and retry.')}
        </p>
        <button className="primary" onClick={() => setRetry((n) => n + 1)}>
          {t('Retry profile setup')}
        </button>
        <button
          className="secondary"
          onClick={() => void signOut(auth!).catch((e) => setProfileError(errorMessage(e)))}
        >
          {t('Sign out')}
        </button>
      </main>
    );
  if (loading)
    return (
      <div className="loading full-screen">
        <LanguageSelector />
        <span className="spinner" />
        {t('Opening your shared space…')}
      </div>
    );
  return user ? (
    <AppContent key={user.uid} user={user} />
  ) : (
    <AuthScreen
      initialError={redirectError}
      invited={new URLSearchParams(window.location.search).has('invite')}
    />
  );
}
