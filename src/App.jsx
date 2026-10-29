import { useEffect, useMemo, useState } from "react";

async function request(path, options = {}) {
  const { workspaceId, ...fetchOptions } = options;
  const response = await fetch(path, {
    ...fetchOptions,
    headers: {
      "Content-Type": "application/json",
      ...(workspaceId ? { "X-Workspace-Id": String(workspaceId) } : {}),
      ...fetchOptions.headers,
    },
  });

  if (response.status === 204) return null;
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Something went wrong.");
  return result;
}

const money = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 2,
});
const shortDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const monthFormat = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const dateLabel = (value) => {
  if (!value) return "No due date";
  const [year, month, day] = value.split("-").map(Number);
  return shortDate.format(new Date(year, month - 1, day));
};
const monthKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

function loanStatus(loan) {
  if (loan.balance <= 0) return "Settled";
  if (loan.dueDate && loan.dueDate < today()) return "Overdue";
  if (loan.dueDate && loan.dueDate <= addDays(today(), 7)) return "Due soon";
  return "Active";
}

function addDays(dateString, days) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function Icon({ name }) {
  const paths = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
    report: <><path d="M4 19V5M4 19h17" /><path d="m7 15 4-4 3 2 6-7" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    arrow: <><path d="m9 18 6-6-6-6" /></>,
    left: <><path d="m15 18-6-6 6-6" /></>,
    right: <><path d="m9 18 6-6-6-6" /></>,
    close: <><path d="m18 6-12 12M6 6l12 12" /></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3" /><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></>,
    wallet: <><rect x="3" y="5" width="18" height="15" rx="2" /><path d="M3 9h18M16 15h.01" /><path d="M6 5V3h12v2" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
    trend: <><path d="m3 17 6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
  };
  return (
    <svg aria-hidden="true" className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

function StatCard({ icon, label, value, detail, tone = "blue" }) {
  return (
    <article className={`stat-card stat-${tone}`}>
      <div className="stat-top">
        <span className="stat-icon"><Icon name={icon} /></span>
        <span className="stat-label">{label}</span>
      </div>
      <strong>{money.format(value)}</strong>
      <span className="stat-detail">{detail}</span>
    </article>
  );
}

function LoanTable({ loans, onPayment }) {
  if (!loans.length) {
    return (
      <div className="empty-state">
        <span className="empty-icon"><Icon name="wallet" /></span>
        <strong>No loans yet</strong>
        <span>Add your first loan to start building your ledger.</span>
      </div>
    );
  }
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr><th>PERSON</th><th>TYPE</th><th>AMOUNT</th><th>REMAINING</th><th>DUE DATE</th><th>STATUS</th><th /></tr>
        </thead>
        <tbody>
          {loans.map((loan) => {
            const status = loanStatus(loan);
            return (
              <tr key={loan.id}>
                <td><span className="person-cell"><span className="avatar">{loan.counterparty.slice(0, 1).toUpperCase()}</span><strong>{loan.counterparty}</strong></span></td>
                <td><span className={`direction direction-${loan.direction}`}>{loan.direction === "lent" ? "Lent" : "Borrowed"}</span></td>
                <td>{money.format(loan.amount)}</td>
                <td className="balance-cell">{money.format(loan.balance)}</td>
                <td>{dateLabel(loan.dueDate)}</td>
                <td><span className={`status status-${status.toLowerCase().replace(" ", "-")}`}><i />{status}</span></td>
                <td>{loan.balance > 0 && <button className="table-action" onClick={() => onPayment(loan)} type="button">Add payment</button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LoanDialog({ onClose, onSave, busy }) {
  const [form, setForm] = useState({
    direction: "lent",
    counterparty: "",
    amount: "",
    loanDate: today(),
    dueDate: "",
    notes: "",
  });
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      await onSave({ ...form, amount: Number(form.amount) });
    } catch (reason) {
      setError(reason.message);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section aria-labelledby="loan-dialog-title" aria-modal="true" className="modal" role="dialog">
        <div className="modal-heading">
          <div><p className="eyebrow">LEDGER ENTRY</p><h2 id="loan-dialog-title">Add a loan</h2></div>
          <button aria-label="Close dialog" className="icon-button" onClick={onClose} type="button"><Icon name="close" /></button>
        </div>
        <p className="modal-intro">Keep track of money you lend or borrow.</p>
        <form className="dialog-form" onSubmit={submit}>
          <label>Loan type</label>
          <div className="segmented-control">
            {["lent", "borrowed"].map((direction) => (
              <button className={form.direction === direction ? "selected" : ""} key={direction} onClick={() => setForm({ ...form, direction })} type="button">
                {direction === "lent" ? "I lent money" : "I borrowed"}
              </button>
            ))}
          </div>
          <label htmlFor="counterparty">Person or organization</label>
          <input autoFocus id="counterparty" maxLength={120} onChange={(event) => setForm({ ...form, counterparty: event.target.value })} placeholder="e.g. Alex Morgan" required value={form.counterparty} />
          <div className="form-grid">
            <div><label htmlFor="amount">Amount (PHP)</label><div className="amount-input"><span>₱</span><input id="amount" min="0.01" onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="0.00" required step="0.01" type="number" value={form.amount} /></div></div>
            <div><label htmlFor="loan-date">Loan date</label><input id="loan-date" onChange={(event) => setForm({ ...form, loanDate: event.target.value })} required type="date" value={form.loanDate} /></div>
          </div>
          <label htmlFor="due-date">Due date <span className="optional">(optional)</span></label>
          <input id="due-date" min={form.loanDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} type="date" value={form.dueDate} />
          <label htmlFor="notes">Notes <span className="optional">(optional)</span></label>
          <textarea id="notes" maxLength={500} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Add a note about this loan" rows="3" value={form.notes} />
          {error && <p className="error" role="alert">{error}</p>}
          <button className="button modal-submit" disabled={busy} type="submit">{busy ? "Saving…" : "Add to ledger"}</button>
        </form>
      </section>
    </div>
  );
}

function PaymentDialog({ loan, onClose, onSave, busy }) {
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(today());
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      await onSave(loan.id, { amount: Number(amount), paymentDate });
    } catch (reason) {
      setError(reason.message);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section aria-labelledby="payment-dialog-title" aria-modal="true" className="modal payment-modal" role="dialog">
        <div className="modal-heading">
          <div><p className="eyebrow">RECORD REPAYMENT</p><h2 id="payment-dialog-title">Add a payment</h2></div>
          <button aria-label="Close dialog" className="icon-button" onClick={onClose} type="button"><Icon name="close" /></button>
        </div>
        <p className="modal-intro">{loan.counterparty} · {money.format(loan.balance)} remaining</p>
        <form className="dialog-form" onSubmit={submit}>
          <label htmlFor="payment-amount">Payment amount (PHP)</label>
          <input autoFocus id="payment-amount" max={loan.balance} min="0.01" onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required step="0.01" type="number" value={amount} />
          <label htmlFor="payment-date">Payment date</label>
          <input id="payment-date" onChange={(event) => setPaymentDate(event.target.value)} required type="date" value={paymentDate} />
          {error && <p className="error" role="alert">{error}</p>}
          <button className="button modal-submit" disabled={busy} type="submit">{busy ? "Saving…" : "Record payment"}</button>
        </form>
      </section>
    </div>
  );
}

function WorkspaceDialog({ onClose, onSave, busy }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      await onSave(name);
    } catch (reason) {
      setError(reason.message);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section aria-labelledby="workspace-dialog-title" aria-modal="true" className="modal compact-modal" role="dialog">
        <div className="modal-heading">
          <div><p className="eyebrow">KEEP THINGS ORGANIZED</p><h2 id="workspace-dialog-title">New workspace</h2></div>
          <button aria-label="Close dialog" className="icon-button" onClick={onClose} type="button"><Icon name="close" /></button>
        </div>
        <p className="modal-intro">Create a separate ledger that you can share with other members.</p>
        <form className="dialog-form" onSubmit={submit}>
          <label htmlFor="workspace-name">Workspace name</label>
          <input autoFocus id="workspace-name" maxLength={60} onChange={(event) => setName(event.target.value)} placeholder="e.g. Household finances" required value={name} />
          {error && <p className="error" role="alert">{error}</p>}
          <button className="button modal-submit" disabled={busy} type="submit">{busy ? "Creating…" : "Create workspace"}</button>
        </form>
      </section>
    </div>
  );
}

function AddUserDialog({ workspace, onClose, onSave, busy }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      await onSave(email);
    } catch (reason) {
      setError(reason.message);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section aria-labelledby="member-dialog-title" aria-modal="true" className="modal compact-modal" role="dialog">
        <div className="modal-heading">
          <div><p className="eyebrow">SHARE THIS LEDGER</p><h2 id="member-dialog-title">Add a user</h2></div>
          <button aria-label="Close dialog" className="icon-button" onClick={onClose} type="button"><Icon name="close" /></button>
        </div>
        <p className="modal-intro">Add someone with an existing account to <strong>{workspace.name}</strong>. This immediately grants access to its loans and payments; no email is sent.</p>
        <form className="dialog-form" onSubmit={submit}>
          <label htmlFor="member-email">Account email</label>
          <input autoComplete="email" autoFocus id="member-email" onChange={(event) => setEmail(event.target.value)} placeholder="person@example.com" required type="email" value={email} />
          {error && <p className="error" role="alert">{error}</p>}
          <button className="button modal-submit" disabled={busy} type="submit">{busy ? "Adding…" : "Add to workspace"}</button>
        </form>
      </section>
    </div>
  );
}

function RemoveWorkspaceDialog({ workspace, onClose, onRemove, busy }) {
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      await onRemove();
    } catch (reason) {
      setError(reason.message);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section aria-labelledby="remove-workspace-title" aria-modal="true" className="modal compact-modal" role="dialog">
        <div className="modal-heading">
          <div><p className="eyebrow">WORKSPACE SETTINGS</p><h2 id="remove-workspace-title">Remove workspace?</h2></div>
          <button aria-label="Close dialog" className="icon-button" onClick={onClose} type="button"><Icon name="close" /></button>
        </div>
        <p className="modal-intro"><strong>{workspace.name}</strong> will be removed for all its members. Only empty workspaces can be removed, and every member must have another workspace. Loan data will not be deleted.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="confirm-actions">
          <button className="cancel-button" onClick={onClose} type="button">Keep workspace</button>
          <button className="button danger-button" disabled={busy} onClick={submit} type="button">{busy ? "Removing…" : "Remove workspace"}</button>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [loans, setLoans] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [activePage, setActivePage] = useState("Overview");
  const [showLoanDialog, setShowLoanDialog] = useState(false);
  const [showWorkspaceDialog, setShowWorkspaceDialog] = useState(false);
  const [showAddUserDialog, setShowAddUserDialog] = useState(false);
  const [showRemoveWorkspaceDialog, setShowRemoveWorkspaceDialog] = useState(false);
  const [paymentLoan, setPaymentLoan] = useState(null);
  const [notice, setNotice] = useState("");
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  useEffect(() => {
    request("/api/auth/me")
      .then((result) => setUser(result.user))
      .catch((reason) => {
        if (reason.message !== "Not signed in.") setError(reason.message);
      })
      .finally(() => setCheckingSession(false));
  }, []);

  useEffect(() => {
    if (!user) {
      setWorkspaces([]);
      setSelectedWorkspaceId(null);
      setLoans([]);
      setWorkspaceLoading(false);
      return;
    }
    let active = true;
    setWorkspaceLoading(true);
    request("/api/workspaces")
      .then((result) => {
        if (!active) return;
        setWorkspaces(result.workspaces);
        const savedId = localStorage.getItem(`ledger.workspace.${user.id}`);
        const selected = result.workspaces.find((workspace) => String(workspace.id) === savedId)
          ?? result.workspaces[0];
        setSelectedWorkspaceId(selected?.id ?? null);
      })
      .catch((reason) => {
        if (active) setError(reason.message);
      })
      .finally(() => {
        if (active) setWorkspaceLoading(false);
      });
    return () => { active = false; };
  }, [user]);

  useEffect(() => {
    if (!user || !selectedWorkspaceId) {
      setLoans([]);
      return;
    }
    let active = true;
    setWorkspaceLoading(true);
    request("/api/loans", { workspaceId: selectedWorkspaceId })
      .then((result) => {
        if (active) setLoans(result.loans);
      })
      .catch((reason) => {
        if (active) setError(reason.message);
      })
      .finally(() => {
        if (active) setWorkspaceLoading(false);
      });
    return () => { active = false; };
  }, [user, selectedWorkspaceId]);

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId);

  const totals = useMemo(() => loans.reduce((result, loan) => {
    result[loan.direction] += loan.balance;
    if (loan.balance > 0 && loan.dueDate && loan.dueDate >= today() && loan.dueDate <= addDays(today(), 30)) {
      result.upcoming += loan.balance;
      result.upcomingCount += 1;
    }
    if (loan.balance > 0) result.active += 1;
    return result;
  }, { lent: 0, borrowed: 0, upcoming: 0, upcomingCount: 0, active: 0 }), [loans]);

  const dueLoans = useMemo(
    () => loans.filter((loan) => loan.balance > 0 && loan.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [loans],
  );

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const result = await request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setUser(result.user);
      setPassword("");
    } catch (reason) {
      setError(reason.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    setError("");
    try {
      await request("/api/auth/logout", { method: "POST" });
      setUser(null);
      setEmail("");
      setActivePage("Overview");
      setWorkspaces([]);
      setSelectedWorkspaceId(null);
      setWorkspaceLoading(false);
      setNotice("");
    } catch (reason) {
      setError(reason.message);
    }
  }

  async function addLoan(loan) {
    setSubmitting(true);
    try {
      const result = await request("/api/loans", { method: "POST", workspaceId: selectedWorkspaceId, body: JSON.stringify(loan) });
      setLoans((current) => [result.loan, ...current]);
      setShowLoanDialog(false);
      setError("");
    } finally {
      setSubmitting(false);
    }
  }

  async function addPayment(loanId, payment) {
    setSubmitting(true);
    try {
      const result = await request(`/api/loans/${loanId}/payments`, { method: "POST", workspaceId: selectedWorkspaceId, body: JSON.stringify(payment) });
      setLoans((current) => current.map((loan) => loan.id === loanId ? result.loan : loan));
      setPaymentLoan(null);
      setError("");
    } finally {
      setSubmitting(false);
    }
  }

  async function createWorkspace(name) {
    setSubmitting(true);
    try {
      const result = await request("/api/workspaces", { method: "POST", body: JSON.stringify({ name }) });
      setWorkspaces((current) => [...current, result.workspace]);
      setSelectedWorkspaceId(result.workspace.id);
      setWorkspaceLoading(false);
      localStorage.setItem(`ledger.workspace.${user.id}`, String(result.workspace.id));
      setLoans([]);
      setShowWorkspaceDialog(false);
      setNotice(`Created ${result.workspace.name}. Add existing accounts to share it.`);
      setError("");
    } finally {
      setSubmitting(false);
    }
  }

  async function addWorkspaceMember(email) {
    if (!selectedWorkspace) throw new Error("Choose a workspace first.");
    setSubmitting(true);
    try {
      const result = await request(`/api/workspaces/${selectedWorkspace.id}/members`, {
        method: "POST",
        workspaceId: selectedWorkspace.id,
        body: JSON.stringify({ email }),
      });
      setWorkspaces((current) => current.map((workspace) =>
        workspace.id === selectedWorkspace.id
          ? { ...workspace, memberCount: result.memberCount }
          : workspace,
      ));
      setShowAddUserDialog(false);
      setNotice(`${result.member.email} can now access ${selectedWorkspace.name}.`);
      setError("");
    } finally {
      setSubmitting(false);
    }
  }

  async function removeWorkspace() {
    if (!selectedWorkspace) throw new Error("Choose a workspace first.");
    setSubmitting(true);
    try {
      await request(`/api/workspaces/${selectedWorkspace.id}`, {
        method: "DELETE",
        workspaceId: selectedWorkspace.id,
      });
      const remainingWorkspaces = workspaces.filter(
        (workspace) => workspace.id !== selectedWorkspace.id,
      );
      const nextWorkspace = remainingWorkspaces[0] ?? null;
      setWorkspaces(remainingWorkspaces);
      setSelectedWorkspaceId(nextWorkspace?.id ?? null);
      localStorage.setItem(
        `ledger.workspace.${user.id}`,
        nextWorkspace ? String(nextWorkspace.id) : "",
      );
      setLoans([]);
      setWorkspaceLoading(Boolean(nextWorkspace));
      setShowRemoveWorkspaceDialog(false);
      setNotice(`Removed ${selectedWorkspace.name} for all its members.`);
      setError("");
    } finally {
      setSubmitting(false);
    }
  }

  function selectWorkspace(event) {
    const workspaceId = Number(event.target.value);
    setSelectedWorkspaceId(workspaceId);
    localStorage.setItem(`ledger.workspace.${user.id}`, String(workspaceId));
    setLoans([]);
    setWorkspaceLoading(true);
    setNotice("");
  }

  if (checkingSession) {
    return <main className="page"><p className="loading">Checking your session…</p></main>;
  }

  if (!user) {
    return (
      <main className="page">
        <section className="card auth-card" aria-labelledby="page-title">
          <div className="brand-mark" aria-hidden="true">L</div>
          <p className="eyebrow">WELCOME BACK</p>
          <h1 id="page-title">Sign in to your account</h1>
          <p className="subtitle">Enter your details to continue.</p>
          <form onSubmit={handleSubmit}>
            <label htmlFor="email">Email address</label>
            <input autoComplete="email" id="email" name="email" onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required type="email" value={email} />
            <label htmlFor="password">Password</label>
            <input autoComplete="current-password" id="password" maxLength={128} name="password" onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" required type="password" value={password} />
            {error && <p className="error" role="alert">{error}</p>}
            <button className="button" disabled={submitting} type="submit">{submitting ? "Please wait…" : "Sign in"}</button>
          </form>
        </section>
        <p className="footer">Your account is protected with secure, private sign-in.</p>
      </main>
    );
  }

  const monthStart = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
  const calendarDays = Array.from({ length: 42 }, (_, index) =>
    new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1 - monthStart.getDay() + index),
  );
  const selectedMonthLoans = dueLoans.filter((loan) => loan.dueDate.startsWith(monthKey(calendarMonth)));
  const upcomingLoans = dueLoans.filter((loan) => loan.dueDate >= today()).slice(0, 5);
  const monthlyReports = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(new Date().getFullYear(), new Date().getMonth() - 5 + index, 1);
    const key = monthKey(date);
    const monthLoans = loans.filter((loan) => loan.loanDate.startsWith(key));
    const payments = loans.flatMap((loan) => loan.payments).filter((payment) => payment.paymentDate.startsWith(key));
    return {
      label: new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit" }).format(date),
      lent: monthLoans.filter((loan) => loan.direction === "lent").reduce((sum, loan) => sum + loan.amount, 0),
      borrowed: monthLoans.filter((loan) => loan.direction === "borrowed").reduce((sum, loan) => sum + loan.amount, 0),
      repaid: payments.reduce((sum, payment) => sum + payment.amount, 0),
    };
  });
  const maxReportValue = Math.max(1, ...monthlyReports.flatMap((month) => [month.lent, month.borrowed, month.repaid]));
  const totalLent = loans.filter((loan) => loan.direction === "lent").reduce((sum, loan) => sum + loan.amount, 0);
  const totalBorrowed = loans.filter((loan) => loan.direction === "borrowed").reduce((sum, loan) => sum + loan.amount, 0);
  const totalReceived = loans.filter((loan) => loan.direction === "lent").reduce((sum, loan) => sum + loan.paid, 0);
  const totalRepaid = loans.filter((loan) => loan.direction === "borrowed").reduce((sum, loan) => sum + loan.paid, 0);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="app-brand" href="#" onClick={(event) => { event.preventDefault(); setActivePage("Overview"); }}>
          <span className="brand-mark">L</span><span>Ledger<span className="brand-dot">.</span></span>
        </a>
        <p className="nav-caption">WORKSPACE</p>
        <nav className="main-nav" aria-label="Main navigation">
          {[["Overview", "overview"], ["Calendar", "calendar"], ["Reports", "report"]].map(([page, icon]) => (
            <button aria-current={activePage === page ? "page" : undefined} className={`nav-item ${activePage === page ? "active" : ""}`} key={page} onClick={() => setActivePage(page)} type="button">
              <Icon name={icon} />{page}{page === "Overview" && <span className="nav-count">{loans.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="profile-card"><span className="profile-avatar">{user.email.slice(0, 1).toUpperCase()}</span><span className="profile-info"><strong>{user.email.split("@")[0]}</strong><small>{user.email}</small></span></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <span className="breadcrumb">Workspace <Icon name="arrow" /> <strong>{activePage}</strong></span>
          <div className="topbar-actions">
            <label className="workspace-picker-label" htmlFor="workspace-picker">Ledger</label>
            <select aria-label="Select workspace" className="workspace-picker" disabled={!workspaces.length} id="workspace-picker" onChange={selectWorkspace} value={selectedWorkspaceId ?? ""}>
              {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name} · {workspace.memberCount} member{workspace.memberCount === 1 ? "" : "s"}</option>)}
            </select>
            <button className="header-action header-add-user" disabled={!selectedWorkspace || workspaceLoading} onClick={() => setShowAddUserDialog(true)} type="button"><Icon name="plus" /><span>Add user</span></button>
            <button className="header-logout" onClick={handleLogout} type="button"><Icon name="logout" /><span>Sign out</span></button>
          </div>
        </header>
        <div className="content-wrap">
          {error && <div className="notice" role="alert">{error}<button aria-label="Dismiss" onClick={() => setError("")} type="button"><Icon name="close" /></button></div>}
          {notice && <div className="notice notice-success" role="status">{notice}<button aria-label="Dismiss" onClick={() => setNotice("")} type="button"><Icon name="close" /></button></div>}

          {activePage === "Overview" && (
            <>
              <section className="page-heading">
                <div><p className="eyebrow">YOUR MONEY, IN ONE PLACE</p><h1>Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}</h1><p className="page-subtitle">Here’s a snapshot of your loans and repayments.</p></div>
                <button className="button add-loan-button" disabled={!selectedWorkspace || workspaceLoading} onClick={() => setShowLoanDialog(true)} type="button"><Icon name="plus" />Add a loan</button>
              </section>
              <section className="stats-grid" aria-label="Loan summary">
                <StatCard detail={`${loans.filter((loan) => loan.direction === "lent" && loan.balance > 0).length} outstanding loan${loans.filter((loan) => loan.direction === "lent" && loan.balance > 0).length === 1 ? "" : "s"}`} icon="trend" label="You’re owed" tone="blue" value={totals.lent} />
                <StatCard detail={`${loans.filter((loan) => loan.direction === "borrowed" && loan.balance > 0).length} outstanding loan${loans.filter((loan) => loan.direction === "borrowed" && loan.balance > 0).length === 1 ? "" : "s"}`} icon="wallet" label="You owe" tone="purple" value={totals.borrowed} />
                <StatCard detail={`${totals.upcomingCount} due in the next 30 days`} icon="clock" label="Upcoming due" tone="orange" value={totals.upcoming} />
                <StatCard detail={`${totals.active} currently active`} icon="check" label="Outstanding balance" tone="green" value={totals.lent + totals.borrowed} />
              </section>
              <div className="dashboard-grid">
                <section className="panel ledger-panel">
                  <div className="panel-heading"><div><h2>Recent loans</h2><p>Your latest ledger activity</p></div><button className="link-button" onClick={() => setActivePage("Reports")} type="button">View reports <Icon name="arrow" /></button></div>
                  <LoanTable loans={loans.slice(0, 6)} onPayment={setPaymentLoan} />
                </section>
                <section className="panel upcoming-panel">
                  <div className="panel-heading"><div><h2>Upcoming due</h2><p>Keep an eye on what’s next</p></div><button aria-label="Open calendar" className="icon-button" onClick={() => setActivePage("Calendar")} type="button"><Icon name="arrow" /></button></div>
                  {upcomingLoans.length ? <div className="upcoming-list">{upcomingLoans.map((loan) => (
                    <article className="upcoming-item" key={loan.id}><span className={`due-date ${loan.dueDate < today() ? "past" : ""}`}><strong>{Number(loan.dueDate.slice(8, 10))}</strong><small>{new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(`${loan.dueDate}T12:00:00`))}</small></span><span className="upcoming-info"><strong>{loan.counterparty}</strong><small>{loan.dueDate < today() ? "Past due" : loan.direction === "lent" ? "Expected repayment" : "Payment due"}</small></span><strong className="upcoming-amount">{money.format(loan.balance)}</strong></article>
                  ))}</div> : <div className="mini-empty"><span className="mini-empty-icon"><Icon name="check" /></span><strong>All clear</strong><span>No upcoming due dates.</span></div>}
                </section>
              </div>
            </>
          )}

          {activePage === "Calendar" && (
            <>
              <section className="page-heading"><div><p className="eyebrow">NEVER MISS A PAYMENT</p><h1>Loan calendar</h1><p className="page-subtitle">See when repayments are due at a glance.</p></div><button className="button add-loan-button" disabled={!selectedWorkspace || workspaceLoading} onClick={() => setShowLoanDialog(true)} type="button"><Icon name="plus" />Add a loan</button></section>
              <section className="panel calendar-panel">
                <div className="calendar-toolbar"><div><h2>{monthFormat.format(calendarMonth)}</h2><p>{selectedMonthLoans.length} loan{selectedMonthLoans.length === 1 ? "" : "s"} with a due date this month</p></div><div className="calendar-controls"><button aria-label="Previous month" className="icon-button" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))} type="button"><Icon name="left" /></button><button className="today-button" onClick={() => setCalendarMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))} type="button">Today</button><button aria-label="Next month" className="icon-button" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))} type="button"><Icon name="right" /></button></div></div>
                <div className="calendar-grid">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div className="weekday" key={day}>{day}</div>)}
                  {calendarDays.map((date) => {
                    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
                    const events = dueLoans.filter((loan) => loan.dueDate === key);
                    return <div className={`calendar-day ${date.getMonth() !== calendarMonth.getMonth() ? "other-month" : ""} ${key === today() ? "is-today" : ""}`} key={key}><span className="day-number">{date.getDate()}</span>{events.slice(0, 2).map((loan) => <span className={`calendar-event ${loan.direction === "borrowed" ? "event-borrowed" : ""} ${key < today() ? "event-overdue" : ""}`} key={loan.id} title={`${loan.counterparty}: ${money.format(loan.balance)}`}><span>{loan.counterparty}</span><strong>{money.format(loan.balance)}</strong></span>)}{events.length > 2 && <span className="more-events">+{events.length - 2} more</span>}</div>;
                  })}
                </div>
                <div className="calendar-legend"><span><i className="legend-lent" />Expected back</span><span><i className="legend-borrowed" />Payment due</span><span><i className="legend-overdue" />Past due</span></div>
              </section>
              <section className="panel month-due-panel"><div className="panel-heading"><div><h2>This month’s due dates</h2><p>Outstanding loans due in {monthFormat.format(calendarMonth)}</p></div></div><LoanTable loans={selectedMonthLoans} onPayment={setPaymentLoan} /></section>
            </>
          )}

          {activePage === "Reports" && (
            <>
              <section className="page-heading"><div><p className="eyebrow">A CLEARER FINANCIAL PICTURE</p><h1>Reports</h1><p className="page-subtitle">Your lending and repayment activity, all in one view.</p></div><button className="button add-loan-button" onClick={() => setActivePage("Overview")} type="button"><Icon name="overview" />View ledger</button></section>
              <section className="stats-grid report-stats">
                <StatCard detail={`${money.format(totalReceived)} received so far`} icon="trend" label="Total lent" tone="blue" value={totalLent} />
                <StatCard detail={`${money.format(totalRepaid)} paid so far`} icon="wallet" label="Total borrowed" tone="purple" value={totalBorrowed} />
                <StatCard detail="Across all lent loans" icon="check" label="Collected" tone="green" value={totalReceived} />
                <StatCard detail="Across all borrowed loans" icon="clock" label="Repaid" tone="orange" value={totalRepaid} />
              </section>
              <section className="panel report-panel">
                <div className="panel-heading"><div><h2>Monthly activity</h2><p>Loans added and repayments recorded over the last six months</p></div><span className="report-unit">PHP</span></div>
                <div className="chart-legend"><span><i className="chart-lent" />Lent</span><span><i className="chart-borrowed" />Borrowed</span><span><i className="chart-repaid" />Repaid</span></div>
                <div className="bar-chart">{monthlyReports.map((month) => (
                  <div className="chart-month" key={month.label}><div className="bar-group">
                    {[["lent", month.lent], ["borrowed", month.borrowed], ["repaid", month.repaid]].map(([type, value]) => <div aria-label={`${type}: ${money.format(value)}`} className={`chart-bar bar-${type}`} key={type} style={{ height: `${value ? Math.max(4, value / maxReportValue * 100) : 0}%` }} title={`${type}: ${money.format(value)}`} />)}
                  </div><span>{month.label}</span></div>
                ))}</div>
              </section>
              <section className="panel report-table-panel">
                <div className="panel-heading"><div><h2>Monthly breakdown</h2><p>Principal added and payments logged by month</p></div></div>
                <div className="table-scroll"><table><thead><tr><th>MONTH</th><th>LENT</th><th>BORROWED</th><th>REPAYMENTS</th><th>NET POSITION</th></tr></thead><tbody>
                  {[...monthlyReports].reverse().map((month) => <tr key={month.label}><td className="report-month">{month.label}</td><td className="positive-value">{money.format(month.lent)}</td><td className="negative-value">{money.format(month.borrowed)}</td><td>{money.format(month.repaid)}</td><td className={month.lent - month.borrowed >= 0 ? "positive-value" : "negative-value"}>{money.format(month.lent - month.borrowed)}</td></tr>)}
                </tbody></table></div>
              </section>
            </>
          )}

          <footer className="app-footer">Ledger <span>·</span> Keep your money organized.</footer>
        </div>
      </main>
      {showLoanDialog && <LoanDialog busy={submitting} onClose={() => setShowLoanDialog(false)} onSave={addLoan} />}
      {paymentLoan && <PaymentDialog busy={submitting} loan={paymentLoan} onClose={() => setPaymentLoan(null)} onSave={addPayment} />}
      {showWorkspaceDialog && <WorkspaceDialog busy={submitting} onClose={() => setShowWorkspaceDialog(false)} onSave={createWorkspace} />}
      {showAddUserDialog && selectedWorkspace && <AddUserDialog busy={submitting} onClose={() => setShowAddUserDialog(false)} onSave={addWorkspaceMember} workspace={selectedWorkspace} />}
      {showRemoveWorkspaceDialog && selectedWorkspace && <RemoveWorkspaceDialog busy={submitting} onClose={() => setShowRemoveWorkspaceDialog(false)} onRemove={removeWorkspace} workspace={selectedWorkspace} />}
    </div>
  );
}
