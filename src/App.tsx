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
import { auth, configurationError, db, usingEmulators } from './services/firebase';
import { leaveLedger, newRecordId, writeFinancial } from './services/ledger';
import { errorMessage } from './services/errors';
import { balances, changedFields, money, settlements } from './domain/finance';
import type {
  AuditEvent,
  FinancialData,
  FinancialRecord,
  Kind,
  Ledger,
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
  return l.members[id]?.name || 'Former member';
}
function AppContent({ user }: { user: User }) {
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
  const [historyLimit, setHistoryLimit] = useState(100);
  const auditState = useLive<AuditEvent>(lid ? `audit:${lid}:${historyLimit}` : '', () =>
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
    body: string;
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
        `${r.data.description} ${r.data.notes} ${ledger ? nameOf(ledger, r.data.payerId) : ''}`
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
  function settle(s: Settlement) {
    if (!ledger) return;
    const snapshot = ledger;
    const id = `settle_${snapshot.revision}_${s.payerId}_${s.receiverId}`;
    const fallback = id.length > 100 ? newRecordId(db!, lid) : id;
    setConfirm({
      title: 'Confirm money was paid',
      body: `Record ${money(s.amount, snapshot.currency)} paid by ${nameOf(snapshot, s.payerId)} to ${nameOf(snapshot, s.receiverId)}? Confirm only after the actual transfer.`,
      run: () =>
        writeFinancial(db!, {
          ledgerId: lid,
          id: fallback,
          actorId: user.uid,
          expectedVersion: 0,
          expectedLedgerRevision: snapshot.revision,
          action: 'settle',
          data: {
            kind: 'repayment',
            description: 'Settlement payment',
            amount: s.amount,
            currency: snapshot.currency,
            date: new Date().toLocaleDateString('en-CA'),
            payerId: s.payerId,
            receiverId: s.receiverId,
            participants: [],
            shares: {},
            weights: {},
            splitMethod: 'equal',
            notes: 'Confirmed from settlement recommendation',
            deleted: false,
            settlementKey: fallback,
          },
        }),
    });
  }
  const renderTable = (rows: FinancialRecord[], compact = false) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Transaction</th>
            <th>Date</th>
            <th>Paid by</th>
            <th className="right">Amount</th>
            <th>
              <span className="sr-only">View</span>
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
                    <strong>{r.data.description}</strong>
                    <small>
                      {r.data.deleted ? 'Deleted · ' : ''}
                      {r.data.kind === 'expense'
                        ? `${r.data.participants.length} people · ${r.data.splitMethod} split`
                        : r.data.kind === 'loan'
                          ? `Loan to ${nameOf(ledger!, r.data.receiverId)}`
                          : `Repayment to ${nameOf(ledger!, r.data.receiverId)}`}
                    </small>
                  </span>
                </button>
              </td>
              <td className="date-cell">{r.data.date}</td>
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
                  aria-label={`View ${r.data.description}`}
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
        <Empty title={compact ? 'Your first shared moment starts here.' : 'No transactions found.'}>
          {compact
            ? 'Add an expense and we’ll take care of the split.'
            : 'Try another filter, or add your first transaction.'}
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
                {nameOf(ledger!, s.payerId)} <span className="muted">pays</span>{' '}
                {nameOf(ledger!, s.receiverId)}
              </strong>
              <small>{compact ? 'Suggested transfer' : 'Recommendation · not yet paid'}</small>
            </div>
            <strong className="amount">{money(s.amount, ledger!.currency)}</strong>
            {!compact && (
              <button
                className="secondary small"
                disabled={!online || busy}
                onClick={() => settle(s)}
              >
                Confirm paid
              </button>
            )}
          </div>
        ))
      ) : (
        <div className="all-settled">
          <CheckCircle2 size={30} />
          <h3>All square.</h3>
          <p>No transfers needed. That’s a good feeling.</p>
        </div>
      )}
      {compact && plan.length > 0 && (
        <button className="text-link" onClick={() => setPage('balances')}>
          View settlement plan <ArrowRight size={15} />
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
            YOUR SHARED SPACE
          </label>
          <div className="ledger-select">
            <span className="ledger-mini">
              <Users size={18} />
            </span>
            <select
              id="ledger-picker"
              aria-label="Selected ledger"
              value={lid}
              onChange={(e) => selectLedger(e.target.value)}
            >
              {!ledger && <option value="">No ledgers yet</option>}
              {ledgerState.items.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </div>
          <button className="new-group" onClick={() => setNewLedger(true)}>
            <Plus size={14} /> Create a ledger
          </button>
        </div>
        <nav aria-label="Main navigation">
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
                {strings.nav[p]}
                {p === 'expenses' && expenses.length > 0 && (
                  <span className="nav-count" aria-hidden="true">
                    {expenses.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-note">
            <span className="privacy-dot" />
            Just between your people.<small>Private by design. Clear by nature.</small>
          </div>
          <button className="profile-button" onClick={() => setProfile(true)}>
            <Avatar name={user.displayName || 'You'} />
            <span>
              <strong>{user.displayName || 'Your account'}</strong>
              <small>Account & profile</small>
            </span>
            <Settings size={16} />
          </button>
          <button
            className="logout"
            onClick={() => void signOut(auth!).catch((e) => setError(errorMessage(e)))}
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </aside>
      <div className="main-layout">
        <header className="topbar">
          <div className="breadcrumbs">
            Your ledgers <span>/</span> <strong>{ledger?.name || 'Getting started'}</strong>
          </div>
          <div className="topbar-meta">
            <span className={`connection ${!online || recordsState.cached ? 'offline' : ''}`}>
              <i />
              {!online
                ? 'Offline · changes not saved'
                : recordsState.cached && lid
                  ? 'Connecting…'
                  : 'Live updates'}
            </span>
            {ledger && <span className="currency-chip">{ledger.currency}</span>}
          </div>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {page === 'dashboard' ? 'THE BIG PICTURE' : strings.nav[page].toUpperCase()}
              </span>
              <h1>{strings.headings[page]}</h1>
              <p className="muted">
                {page === 'dashboard'
                  ? `Here’s where things stand${ledger ? ` in ${ledger.name}` : ''}.`
                  : page === 'expenses'
                    ? 'The little things add up. Keep them all in one place.'
                    : page === 'balances'
                      ? 'Fewer transfers. A fresh start for everyone.'
                      : page === 'activity'
                        ? 'A shared record you can always come back to.'
                        : 'A few details that keep everyone on the same page.'}
              </p>
            </div>
            {ledger && page !== 'settings' && (
              <button
                className="primary"
                disabled={!online || loading || !!calculationError || !!recordsState.error}
                onClick={() => setForm({ kind: page === 'balances' ? 'repayment' : 'expense' })}
              >
                <Plus size={18} />
                {page === 'balances' ? 'Record repayment' : 'Add expense'}
              </button>
            )}
          </div>
          {usingEmulators && (
            <div className="emulator-strip">
              LOCAL EMULATOR · isolated test data · no production Firebase connection
            </div>
          )}
          {!user.emailVerified && (
            <div className="verification-note">
              <span>Verify your email to accept invitations.</span>
              <button
                onClick={() =>
                  void action(
                    () => sendEmailVerification(user),
                    'Verification email sent. Check your inbox.',
                  )
                }
              >
                Send verification email
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
                Refresh verification
              </button>
            </div>
          )}
          {notice && (
            <div className="alert success toast" role="status">
              <Check size={17} />
              {notice}
              <button aria-label="Dismiss notification" onClick={() => setNotice('')}>
                <X size={15} />
              </button>
            </div>
          )}
          {(error || ledgerState.error || recordsState.error || calculationError) && (
            <div className="alert error" role="alert">
              {error || ledgerState.error || recordsState.error || calculationError}
            </div>
          )}
          {loading ? (
            <div className="loading">
              <span className="spinner" />
              {online ? 'Getting your ledger ready…' : 'Offline — reconnect to load your ledger.'}
            </div>
          ) : recordsState.error || calculationError ? (
            <Empty title="Ledger data is unavailable.">
              <span>Reconnect to load verified balances.</span>
              <br />
              <button className="secondary" onClick={() => window.location.reload()}>
                Reconnect
              </button>
            </Empty>
          ) : !ledger ? (
            <section className="welcome-card">
              <div className="welcome-art">
                <Layers3 size={66} />
              </div>
              <span className="eyebrow">A CLEAN SLATE</span>
              <h2>Sharing starts with a space.</h2>
              <p>
                Create a ledger for your roommates, your next trip,
                <br />
                or simply the people you split things with.
              </p>
              <button className="primary" onClick={() => setNewLedger(true)}>
                <Plus size={18} />
                Create your first ledger
              </button>
              <p className="field-help">
                Have an invitation? Open the link your friend shared with you.
              </p>
            </section>
          ) : (
            <>
              {page === 'dashboard' && (
                <>
                  <section className="summary-grid">
                    <div className="personal-card">
                      <div className="card-top">
                        <span>YOUR NET BALANCE</span>
                        <ArrowUpRight size={20} />
                      </div>
                      <div className="big-amount">
                        {money(Math.abs(net[user.uid] || 0), ledger.currency)}
                        <span>{ledger.currency}</span>
                      </div>
                      <p>
                        {(net[user.uid] || 0) > 0
                          ? 'You’re owed. We’ll help make things even.'
                          : (net[user.uid] || 0) < 0
                            ? 'You owe. A little settling goes a long way.'
                            : 'You’re all settled up. Nice and easy.'}
                      </p>
                      <div className="personal-footer">
                        <span className="light-dot" />
                        {(net[user.uid] || 0) >= 0
                          ? 'A clearer picture, for everyone.'
                          : 'See your next steps in the settlement plan.'}
                      </div>
                    </div>
                    <div className="stat-card">
                      <span className="stat-icon">
                        <Receipt size={21} />
                      </span>
                      <span className="eyebrow">TOTAL SHARED SPENDING</span>
                      <strong>{money(spending, ledger.currency)}</strong>
                      <p>
                        Across {expenses.length} shared{' '}
                        {expenses.length === 1 ? 'expense' : 'expenses'}
                      </p>
                      <span className="stat-foot">All time · {ledger.currency}</span>
                    </div>
                    <div className="stat-card">
                      <span className="stat-icon peach">
                        <Users size={21} />
                      </span>
                      <span className="eyebrow">IN THIS TOGETHER</span>
                      <strong>
                        {ledger.memberIds.length}{' '}
                        <span className="unit">
                          {ledger.memberIds.length === 1 ? 'member' : 'members'}
                        </span>
                      </strong>
                      <div className="avatar-stack">
                        {ledger.memberIds.map((id) => (
                          <Avatar key={id} name={nameOf(ledger, id)} small />
                        ))}
                      </div>
                      <button className="text-link stat-foot" onClick={() => setPage('settings')}>
                        Meet your group <ArrowRight size={14} />
                      </button>
                    </div>
                  </section>
                  <div className="dashboard-columns">
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Recent activity</h2>
                          <p>The latest things you’ve shared.</p>
                        </div>
                        <button className="text-link" onClick={() => setPage('expenses')}>
                          View all <ArrowRight size={15} />
                        </button>
                      </div>
                      {renderTable(recent.slice(0, 5), true)}
                    </section>
                    <section className="panel settlement-panel">
                      <div className="panel-heading">
                        <div>
                          <span className="eyebrow">THE WAY TO EVEN</span>
                          <h2>Settle with ease.</h2>
                          <p>A simpler plan for your group.</p>
                        </div>
                      </div>
                      {renderPlan(true)}
                      <div className="plan-note">
                        <CircleHelp size={15} />
                        <span>
                          Suggestions only. Confirm a payment after money actually changes hands.
                        </span>
                      </div>
                    </section>
                  </div>
                  <div className="bottom-note">
                    <Layers3 size={17} />
                    <span>Less keeping score. More making memories.</span>
                    <span className="reconciled">
                      <CheckCircle2 size={14} />
                      Balances reconcile to zero
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
                        aria-label="Search transactions"
                        placeholder="Search expenses, people, notes…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                    <select
                      aria-label="Filter transactions"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="active">All active transactions</option>
                      <option value="expense">Expenses</option>
                      <option value="loan">Direct loans</option>
                      <option value="repayment">Repayments</option>
                      <option value="deleted">Deleted transactions</option>
                    </select>
                    <select
                      aria-label="Sort transactions"
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                    >
                      <option value="newest">Newest first</option>
                      <option value="oldest">Oldest first</option>
                      <option value="amount">Highest amount</option>
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
                          <h2>Where everyone stands</h2>
                          <p>Positive means owed. Negative means owing.</p>
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
                                {id === user.uid ? ' (you)' : ''}
                              </strong>
                              <small>
                                {!ledger.memberIds.includes(id)
                                  ? 'Former member · balance retained'
                                  : id === ledger.ownerId
                                    ? 'Ledger owner'
                                    : 'Member'}
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
                        Group total{' '}
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
                          <h2>Suggested settlements</h2>
                          <p>Deterministic netting. Fewer unnecessary transfers.</p>
                        </div>
                      </div>
                      {renderPlan()}
                      <div className="plan-note">
                        <CircleHelp size={15} />
                        <span>
                          Largest balances first. This greedy plan is valid, but may not use the
                          absolute fewest transfers. Repayments are separate financial records.
                        </span>
                      </div>
                    </section>
                  </div>
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Loans & repayments</h2>
                        <p>Actual movements of money, kept separate from expenses.</p>
                      </div>
                      <button className="secondary" onClick={() => setForm({ kind: 'loan' })}>
                        <Plus size={16} />
                        Record loan
                      </button>
                    </div>
                    {renderTable(recent.filter((r) => r.data.kind !== 'expense'))}
                  </section>
                </>
              )}
              {page === 'activity' && (
                <section className="panel activity-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Ledger history</h2>
                      <p>Immutable versions. Server timestamps. A clear paper trail.</p>
                    </div>
                    <span className="pill">
                      <Clock3 size={14} /> Latest {historyLimit}
                    </span>
                  </div>
                  {auditState.error && <div className="alert error">{auditState.error}</div>}
                  {auditState.loading ? (
                    <div className="loading">Loading history…</div>
                  ) : !auditState.items.length ? (
                    <Empty title="A story waiting to be written.">
                      Every financial change will appear here.
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
                                  <span className="muted">
                                    {
                                      (
                                        {
                                          create: 'created',
                                          edit: 'edited',
                                          delete: 'deleted',
                                          restore: 'restored',
                                          settle: 'confirmed payment for',
                                        } as const
                                      )[a.action]
                                    }
                                  </span>{' '}
                                  <button
                                    className="inline-link"
                                    onClick={() => setDetail(a.recordId)}
                                  >
                                    {a.after.description}
                                  </button>
                                </strong>
                                <time>{dateText(a.at)}</time>
                              </div>
                              <div className="diff-list">
                                {changedFields(a.before, a.after).map((field) => (
                                  <div className="diff-row" key={field}>
                                    <span>{field.replace(/([A-Z])/g, ' $1')}</span>
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
                                Version {a.version} · {a.after.kind}
                                {current && a.version !== current.version && (
                                  <button
                                    className="text-link"
                                    onClick={() => restore(current, a.after)}
                                  >
                                    Restore this version
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
                        Load older history
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
                      body: `You’ll lose access to this ledger. Your transaction history and ${money(net[user.uid] || 0, ledger.currency)} balance remain for the other members; leaving does not forgive debt. Ask the owner for a new invitation if you need to return.`,
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
            settle. <span className="muted">A little clarity, together.</span>
          </span>
          <span>Private ledgers · No payment processing</span>
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
        <Dialog title={detailRecord.data.description} onClose={() => setDetail(null)}>
          <div className="record-detail">
            <span className="pill">
              {detailRecord.data.kind} · Version {detailRecord.version}
              {detailRecord.data.deleted ? ' · Deleted' : ''}
            </span>
            <div className="detail-amount">
              {money(detailRecord.data.amount, ledger.currency)} <small>{ledger.currency}</small>
            </div>
            <p>
              {detailRecord.data.kind === 'loan' ? 'Lent' : 'Paid'} by{' '}
              <strong>{nameOf(ledger, detailRecord.data.payerId)}</strong>
              {detailRecord.data.receiverId && (
                <>
                  {' '}
                  to <strong>{nameOf(ledger, detailRecord.data.receiverId)}</strong>
                </>
              )}{' '}
              on {detailRecord.data.date}
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
            {detailRecord.data.notes && <p className="notes">{detailRecord.data.notes}</p>}
            <p className="field-help">
              Created by {nameOf(ledger, detailRecord.createdBy)} ·{' '}
              {dateText(detailRecord.createdAt)}
              <br />
              Last changed by {nameOf(ledger, detailRecord.updatedBy)} ·{' '}
              {dateText(detailRecord.updatedAt)}
            </p>
            <div className="dialog-footer">
              <button
                className="text-link"
                onClick={() => {
                  setDetail(null);
                  setPage('activity');
                }}
              >
                View history <ArrowRight size={14} />
              </button>
              {detailRecord.data.deleted ? (
                <button
                  className="primary"
                  onClick={() => restore(detailRecord, detailRecord.data)}
                >
                  Restore transaction
                </button>
              ) : (
                <>
                  <button className="danger-text" onClick={() => remove(detailRecord)}>
                    Delete
                  </button>
                  <button
                    className="primary"
                    onClick={() => setForm({ kind: detailRecord.data.kind, record: detailRecord })}
                  >
                    Edit transaction
                  </button>
                </>
              )}
            </div>
          </div>
        </Dialog>
      )}
      {confirm && (
        <Dialog title={confirm.title} onClose={() => setConfirm(null)} busy={busy}>
          <p className="confirm-body">{confirm.body}</p>
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          <div className="dialog-footer">
            <button className="secondary" disabled={busy} onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={busy || !online}
              onClick={() => void action(confirm.run, 'Change saved and synchronized.')}
            >
              {busy ? 'Saving to server…' : 'Confirm'}
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
          `${nameOf(ledger, id)}: ${d.splitMethod === 'percentage' ? `${n / 100}%` : d.splitMethod === 'exact' ? money(n, ledger.currency) : n}`,
      )
      .join(', ');
  return typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value || '—');
}
export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!auth || !db) {
      setLoading(false);
      return;
    }
    let generation = 0;
    const stop = onAuthStateChanged(auth, (u) => {
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
    return () => {
      generation++;
      stop();
    };
  }, [retry]);
  if (configurationError)
    return (
      <div className="configuration">
        <Layers3 size={40} />
        <h1>Let’s connect your shared space.</h1>
        <p>{configurationError}</p>
        <code>VITE_USE_EMULATORS=true npm run dev</code>
        <p>
          Start Firebase emulators in another terminal with <code>npm run emulators</code>.
        </p>
      </div>
    );
  if (profileError)
    return (
      <main className="configuration">
        <h1>We couldn’t load your profile.</h1>
        <div className="alert error" role="alert">
          {profileError}
        </div>
        <p>Your sign-in completed, but your profile has not synchronized. Reconnect and retry.</p>
        <button className="primary" onClick={() => setRetry((n) => n + 1)}>
          Retry profile setup
        </button>
        <button
          className="secondary"
          onClick={() => void signOut(auth!).catch((e) => setProfileError(errorMessage(e)))}
        >
          Sign out
        </button>
      </main>
    );
  if (loading)
    return (
      <div className="loading full-screen">
        <span className="spinner" />
        Opening your shared space…
      </div>
    );
  return user ? (
    <AppContent key={user.uid} user={user} />
  ) : (
    <AuthScreen invited={new URLSearchParams(window.location.search).has('invite')} />
  );
}
