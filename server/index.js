const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");
const express = require("express");
const { DatabaseSync } = require("node:sqlite");

const scrypt = promisify(crypto.scrypt);
const sessionDurationMs = 7 * 24 * 60 * 60 * 1000;
const cookieName = "login_session";
const app = express();

const databasePath =
  process.env.DATABASE_PATH ||
  path.join(__dirname, "data", "auth.sqlite");

if (databasePath !== ":memory:") {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
}

const db = new DatabaseSync(databasePath);
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS workspaces (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS workspace_memberships (
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (workspace_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS loans (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    direction TEXT NOT NULL CHECK (direction IN ('lent', 'borrowed')),
    counterparty TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    loan_date TEXT NOT NULL,
    due_date TEXT,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS loan_payments (
    id INTEGER PRIMARY KEY,
    loan_id INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    payment_date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const loanColumns = db.prepare("PRAGMA table_info(loans)").all();
if (!loanColumns.some((column) => column.name === "workspace_id")) {
  db.exec("ALTER TABLE loans ADD COLUMN workspace_id INTEGER REFERENCES workspaces(id)");
}

for (const user of db.prepare("SELECT id, email FROM users").all()) {
  const membership = db
    .prepare("SELECT workspace_id FROM workspace_memberships WHERE user_id = ? LIMIT 1")
    .get(user.id);
  let workspaceId = membership?.workspace_id;

  if (!workspaceId) {
    const workspaceName = `${user.email.split("@")[0]}'s ledger`.slice(0, 60);
    const result = db
      .prepare("INSERT INTO workspaces (name, owner_id) VALUES (?, ?)")
      .run(workspaceName, user.id);
    workspaceId = Number(result.lastInsertRowid);
    db.prepare(
      "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES (?, ?, 'owner')",
    ).run(workspaceId, user.id);
  }

  db.prepare("UPDATE loans SET workspace_id = ? WHERE user_id = ? AND workspace_id IS NULL")
    .run(workspaceId, user.id);
}

app.use(express.json({ limit: "10kb" }));

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function readCookie(request, name) {
  const cookies = request.headers.cookie?.split(";") ?? [];
  const cookie = cookies.find((part) => part.trim().startsWith(`${name}=`));
  return cookie ? cookie.trim().slice(name.length + 1) : null;
}

function setSessionCookie(response, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${cookieName}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionDurationMs / 1000}${secure}`,
  );
}

function clearSessionCookie(response) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`,
  );
}

function publicUser(user) {
  return { id: user.id, email: user.email };
}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function validEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function passwordHash(password, salt) {
  return scrypt(password, salt, 64);
}

function issueSession(response, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + sessionDurationMs;

  db.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
  ).run(hashToken(token), userId, expiresAt);
  setSessionCookie(response, token);
}

function requireSession(request, response, next) {
  const token = readCookie(request, cookieName);
  if (!token) {
    return response.status(401).json({ error: "Please sign in to continue." });
  }

  const session = db
    .prepare(
      `SELECT users.id, users.email, sessions.expires_at
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ?`,
    )
    .get(hashToken(token));

  if (!session || session.expires_at <= Date.now()) {
    if (session) {
      db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
    }
    clearSessionCookie(response);
    return response.status(401).json({ error: "Please sign in to continue." });
  }

  request.user = publicUser(session);
  return next();
}

function requireWorkspace(request, response, next) {
  const requestedId = Number(request.get("X-Workspace-Id"));
  const membership = Number.isSafeInteger(requestedId) && requestedId > 0
    ? db
        .prepare(
          `SELECT workspaces.id, workspaces.name, workspace_memberships.role
           FROM workspace_memberships
           JOIN workspaces ON workspaces.id = workspace_memberships.workspace_id
           WHERE workspace_memberships.user_id = ? AND workspaces.id = ?`,
        )
        .get(request.user.id, requestedId)
    : db
        .prepare(
          `SELECT workspaces.id, workspaces.name, workspace_memberships.role
           FROM workspace_memberships
           JOIN workspaces ON workspaces.id = workspace_memberships.workspace_id
           WHERE workspace_memberships.user_id = ?
           ORDER BY workspace_memberships.role = 'owner' DESC, workspaces.id
           LIMIT 1`,
        )
        .get(request.user.id);

  if (!membership) {
    return response.status(requestedId ? 403 : 404).json({
      error: requestedId ? "You do not have access to this workspace." : "No workspace found.",
    });
  }
  request.workspace = membership;
  return next();
}

function isValidDate(value, optional = false) {
  if (optional && (value === undefined || value === null || value === "")) {
    return true;
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function toCents(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

function getWorkspaceLoans(workspaceId) {
  const loans = db
    .prepare(
      `SELECT loans.id, loans.direction, loans.counterparty,
              loans.amount_cents, loans.loan_date, loans.due_date, loans.notes,
              COALESCE(SUM(loan_payments.amount_cents), 0) AS paid_cents
       FROM loans
       LEFT JOIN loan_payments ON loan_payments.loan_id = loans.id
       WHERE loans.workspace_id = ?
       GROUP BY loans.id
       ORDER BY loans.loan_date DESC, loans.id DESC`,
    )
    .all(workspaceId);
  const payments = db
    .prepare(
      `SELECT loan_payments.id, loans.id AS loan_id, loan_payments.amount_cents,
              loan_payments.payment_date
       FROM loan_payments JOIN loans ON loans.id = loan_payments.loan_id
       WHERE loans.workspace_id = ?
       ORDER BY loan_payments.payment_date DESC, loan_payments.id DESC`,
    )
    .all(workspaceId);
  const paymentsByLoan = new Map();
  for (const payment of payments) {
    const list = paymentsByLoan.get(payment.loan_id) ?? [];
    list.push({
      id: payment.id,
      amount: payment.amount_cents / 100,
      paymentDate: payment.payment_date,
    });
    paymentsByLoan.set(payment.loan_id, list);
  }

  return loans.map((loan) => ({
    id: loan.id,
    direction: loan.direction,
    counterparty: loan.counterparty,
    amount: loan.amount_cents / 100,
    paid: loan.paid_cents / 100,
    balance: (loan.amount_cents - loan.paid_cents) / 100,
    loanDate: loan.loan_date,
    dueDate: loan.due_date,
    notes: loan.notes,
    payments: paymentsByLoan.get(loan.id) ?? [],
  }));
}

app.post("/api/auth/register", async (request, response) => {
  const email = normalizeEmail(request.body?.email);
  const password = request.body?.password;

  if (!validEmail(email)) {
    return response.status(400).json({ error: "Enter a valid email address." });
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    return response
      .status(400)
      .json({ error: "Password must be between 8 and 128 characters." });
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const passwordDigest = await passwordHash(password, salt);
  const result = db
    .prepare(
      "INSERT OR IGNORE INTO users (email, password_hash, password_salt) VALUES (?, ?, ?)",
    )
    .run(email, passwordDigest.toString("hex"), salt);

  if (result.changes === 0) {
    return response.status(409).json({ error: "An account with that email already exists." });
  }

  const user = db.prepare("SELECT id, email FROM users WHERE email = ?").get(email);
  const workspaceName = `${email.split("@")[0]}'s ledger`.slice(0, 60);
  const workspace = db
    .prepare("INSERT INTO workspaces (name, owner_id) VALUES (?, ?)")
    .run(workspaceName, user.id);
  db.prepare(
    "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES (?, ?, 'owner')",
  ).run(Number(workspace.lastInsertRowid), user.id);
  issueSession(response, user.id);
  return response.status(201).json({ user: publicUser(user) });
});

app.post("/api/auth/login", async (request, response) => {
  const email = normalizeEmail(request.body?.email);
  const password = request.body?.password;

  if (!validEmail(email) || typeof password !== "string" || password.length > 128) {
    return response.status(400).json({ error: "Enter a valid email and password." });
  }

  const user = db
    .prepare("SELECT id, email, password_hash, password_salt FROM users WHERE email = ?")
    .get(email);

  if (!user) {
    return response.status(401).json({ error: "Email or password is incorrect." });
  }

  const candidate = await passwordHash(password, user.password_salt);
  const expected = Buffer.from(user.password_hash, "hex");
  if (
    candidate.length !== expected.length ||
    !crypto.timingSafeEqual(candidate, expected)
  ) {
    return response.status(401).json({ error: "Email or password is incorrect." });
  }

  issueSession(response, user.id);
  return response.json({ user: publicUser(user) });
});

app.get("/api/auth/me", (request, response) => {
  const token = readCookie(request, cookieName);
  if (!token) {
    return response.status(401).json({ error: "Not signed in." });
  }

  const session = db
    .prepare(
      `SELECT users.id, users.email, sessions.expires_at
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ?`,
    )
    .get(hashToken(token));

  if (!session || session.expires_at <= Date.now()) {
    if (session) {
      db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
    }
    clearSessionCookie(response);
    return response.status(401).json({ error: "Not signed in." });
  }

  return response.json({ user: publicUser(session) });
});

app.post("/api/auth/logout", (request, response) => {
  const token = readCookie(request, cookieName);
  if (token) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  }
  clearSessionCookie(response);
  return response.status(204).end();
});

app.get("/api/workspaces", requireSession, (request, response) => {
  const workspaces = db
    .prepare(
      `SELECT workspaces.id, workspaces.name, workspace_memberships.role,
              workspaces.owner_id,
              (SELECT COUNT(*) FROM workspace_memberships AS members
               WHERE members.workspace_id = workspaces.id) AS member_count
       FROM workspace_memberships
       JOIN workspaces ON workspaces.id = workspace_memberships.workspace_id
       WHERE workspace_memberships.user_id = ?
       ORDER BY workspace_memberships.role = 'owner' DESC, workspaces.id`,
    )
    .all(request.user.id)
    .map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      role: workspace.role,
      memberCount: workspace.member_count,
      isOwner: workspace.owner_id === request.user.id,
    }));
  return response.json({ workspaces });
});

app.post("/api/workspaces", requireSession, (request, response) => {
  const name = typeof request.body?.name === "string" ? request.body.name.trim() : "";
  if (!name || name.length > 60) {
    return response.status(400).json({ error: "Workspace name must be between 1 and 60 characters." });
  }

  const result = db
    .prepare("INSERT INTO workspaces (name, owner_id) VALUES (?, ?)")
    .run(name, request.user.id);
  const workspaceId = Number(result.lastInsertRowid);
  db.prepare(
    "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES (?, ?, 'owner')",
  ).run(workspaceId, request.user.id);

  return response.status(201).json({
    workspace: { id: workspaceId, name, role: "owner", memberCount: 1, isOwner: true },
  });
});

app.post("/api/workspaces/:id/members", requireSession, requireWorkspace, (request, response) => {
  if (Number(request.params.id) !== request.workspace.id) {
    return response.status(403).json({ error: "You do not have access to this workspace." });
  }

  const email = normalizeEmail(request.body?.email);
  if (!validEmail(email)) {
    return response.status(400).json({ error: "Enter a valid email address." });
  }
  if (email === request.user.email) {
    return response.status(400).json({ error: "You are already a member of this workspace." });
  }

  const invitedUser = db.prepare("SELECT id, email FROM users WHERE email = ?").get(email);
  if (!invitedUser) {
    return response.status(404).json({ error: "No account exists for that email address." });
  }

  const result = db
    .prepare(
      `INSERT OR IGNORE INTO workspace_memberships (workspace_id, user_id, role)
       VALUES (?, ?, 'member')`,
    )
    .run(request.workspace.id, invitedUser.id);
  if (result.changes === 0) {
    return response.status(409).json({ error: "That account is already in this workspace." });
  }

  const memberCount = db
    .prepare("SELECT COUNT(*) AS count FROM workspace_memberships WHERE workspace_id = ?")
    .get(request.workspace.id).count;
  return response.status(201).json({
    member: { id: invitedUser.id, email: invitedUser.email },
    memberCount,
  });
});

app.delete("/api/workspaces/:id", requireSession, requireWorkspace, (request, response) => {
  if (Number(request.params.id) !== request.workspace.id) {
    return response.status(403).json({ error: "You do not have access to this workspace." });
  }

  const loans = db
    .prepare("SELECT COUNT(*) AS count FROM loans WHERE workspace_id = ?")
    .get(request.workspace.id).count;
  if (loans > 0) {
    return response.status(409).json({
      error: "This workspace contains loans. Only empty workspaces can be removed.",
    });
  }

  const membersWithoutAnotherWorkspace = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM workspace_memberships AS current_membership
       WHERE current_membership.workspace_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM workspace_memberships AS other_membership
           WHERE other_membership.user_id = current_membership.user_id
             AND other_membership.workspace_id != current_membership.workspace_id
         )`,
    )
    .get(request.workspace.id).count;
  if (membersWithoutAnotherWorkspace > 0) {
    return response.status(409).json({
      error: "Every workspace member must have another workspace before this one can be removed.",
    });
  }

  db.prepare("DELETE FROM workspaces WHERE id = ?").run(request.workspace.id);
  return response.status(204).end();
});

app.get("/api/loans", requireSession, requireWorkspace, (request, response) => {
  return response.json({ loans: getWorkspaceLoans(request.workspace.id) });
});

app.post("/api/loans", requireSession, requireWorkspace, (request, response) => {
  const { direction, counterparty, amount, loanDate, dueDate, notes = "" } =
    request.body ?? {};
  const amountCents = toCents(amount);

  if (direction !== "lent" && direction !== "borrowed") {
    return response.status(400).json({ error: "Choose whether this loan was lent or borrowed." });
  }
  if (
    typeof counterparty !== "string" ||
    !counterparty.trim() ||
    counterparty.trim().length > 120
  ) {
    return response.status(400).json({ error: "Enter a name up to 120 characters." });
  }
  if (amountCents === null) {
    return response.status(400).json({ error: "Enter a valid loan amount greater than zero." });
  }
  if (!isValidDate(loanDate) || !isValidDate(dueDate, true)) {
    return response.status(400).json({ error: "Enter valid loan and due dates." });
  }
  if (dueDate && dueDate < loanDate) {
    return response.status(400).json({ error: "The due date cannot be before the loan date." });
  }
  if (typeof notes !== "string" || notes.length > 500) {
    return response.status(400).json({ error: "Notes must be 500 characters or fewer." });
  }

  const result = db
    .prepare(
      `INSERT INTO loans
       (user_id, workspace_id, direction, counterparty, amount_cents, loan_date, due_date, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      request.user.id,
      request.workspace.id,
      direction,
      counterparty.trim(),
      amountCents,
      loanDate,
      dueDate || null,
      notes.trim(),
    );

  const loan = getWorkspaceLoans(request.workspace.id).find((item) => item.id === Number(result.lastInsertRowid));
  return response.status(201).json({ loan });
});

app.post("/api/loans/:id/payments", requireSession, requireWorkspace, (request, response) => {
  const loanId = Number(request.params.id);
  const amountCents = toCents(request.body?.amount);
  const paymentDate = request.body?.paymentDate;

  if (!Number.isSafeInteger(loanId) || loanId < 1) {
    return response.status(400).json({ error: "Invalid loan." });
  }
  const loan = db
    .prepare("SELECT id, amount_cents FROM loans WHERE id = ? AND workspace_id = ?")
    .get(loanId, request.workspace.id);
  if (!loan) {
    return response.status(404).json({ error: "Loan not found." });
  }
  if (amountCents === null) {
    return response.status(400).json({ error: "Enter a valid payment amount greater than zero." });
  }
  if (!isValidDate(paymentDate)) {
    return response.status(400).json({ error: "Enter a valid payment date." });
  }

  const paid = db
    .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS paid_cents FROM loan_payments WHERE loan_id = ?")
    .get(loanId).paid_cents;
  if (amountCents > loan.amount_cents - paid) {
    return response.status(400).json({ error: "Payment cannot exceed the remaining balance." });
  }

  db.prepare(
    "INSERT INTO loan_payments (loan_id, amount_cents, payment_date) VALUES (?, ?, ?)",
  ).run(loanId, amountCents, paymentDate);
  const updatedLoan = getWorkspaceLoans(request.workspace.id).find((item) => item.id === loanId);
  return response.status(201).json({ loan: updatedLoan });
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "..", "dist")));
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3001;
  app.listen(port, () => {
    console.log(`Login API listening on http://localhost:${port}`);
  });
}

module.exports = { app, db };
