const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");

process.env.DATABASE_PATH = ":memory:";
const { app, db } = require("../server");
delete process.env.DATABASE_PATH;

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  db.close();
});

test("registers an account, authenticates the session, and logs out", async () => {
  const email = `person-${Date.now()}@example.com`;
  const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "correct-horse-battery" }),
  });

  assert.equal(registerResponse.status, 201);
  const registered = await registerResponse.json();
  assert.equal(registered.user.email, email);
  assert.equal("password_hash" in registered.user, false);

  const cookie = registerResponse.headers.get("set-cookie").split(";")[0];
  const sessionResponse = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: cookie },
  });
  assert.equal(sessionResponse.status, 200);
  assert.equal((await sessionResponse.json()).user.email, email);

  const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  assert.equal(logoutResponse.status, 204);

  const expiredResponse = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: cookie },
  });
  assert.equal(expiredResponse.status, 401);
});

test("rejects duplicate registrations and invalid passwords", async () => {
  const email = `duplicate-${Date.now()}@example.com`;
  const payload = JSON.stringify({ email, password: "correct-horse-battery" });
  const headers = { "Content-Type": "application/json" };

  const first = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers,
    body: payload,
  });
  const duplicate = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers,
    body: payload,
  });
  const invalidPassword = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email: `short-${email}`, password: "short" }),
  });

  assert.equal(first.status, 201);
  assert.equal(duplicate.status, 409);
  assert.equal(invalidPassword.status, 400);
});

test("uses a generic error for incorrect passwords", async () => {
  const email = `login-${Date.now()}@example.com`;
  await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "correct-horse-battery" }),
  });

  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "not-the-password" }),
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: "Email or password is incorrect.",
  });
});

test("keeps the loan ledger private and records payments against the balance", async () => {
  const headers = { "Content-Type": "application/json" };
  const firstEmail = `lender-${Date.now()}@example.com`;
  const firstRegistration = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email: firstEmail, password: "correct-horse-battery" }),
  });
  const firstCookie = firstRegistration.headers.get("set-cookie").split(";")[0];

  const unauthenticated = await fetch(`${baseUrl}/api/loans`);
  assert.equal(unauthenticated.status, 401);

  const createResponse = await fetch(`${baseUrl}/api/loans`, {
    method: "POST",
    headers: { ...headers, Cookie: firstCookie },
    body: JSON.stringify({
      direction: "lent",
      counterparty: "Alex Morgan",
      amount: 125.5,
      loanDate: "2026-10-01",
      dueDate: "2026-11-01",
      notes: "Travel costs",
    }),
  });
  assert.equal(createResponse.status, 201);
  const createdLoan = (await createResponse.json()).loan;
  assert.equal(createdLoan.balance, 125.5);

  const secondRegistration = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email: `another-${Date.now()}@example.com`,
      password: "correct-horse-battery",
    }),
  });
  const secondCookie = secondRegistration.headers.get("set-cookie").split(";")[0];
  const otherUserLoans = await fetch(`${baseUrl}/api/loans`, {
    headers: { Cookie: secondCookie },
  });
  assert.deepEqual((await otherUserLoans.json()).loans, []);

  const overpayment = await fetch(`${baseUrl}/api/loans/${createdLoan.id}/payments`, {
    method: "POST",
    headers: { ...headers, Cookie: firstCookie },
    body: JSON.stringify({ amount: 125.51, paymentDate: "2026-10-15" }),
  });
  assert.equal(overpayment.status, 400);

  const paymentResponse = await fetch(`${baseUrl}/api/loans/${createdLoan.id}/payments`, {
    method: "POST",
    headers: { ...headers, Cookie: firstCookie },
    body: JSON.stringify({ amount: 25.5, paymentDate: "2026-10-15" }),
  });
  assert.equal(paymentResponse.status, 201);
  const updatedLoan = (await paymentResponse.json()).loan;
  assert.equal(updatedLoan.paid, 25.5);
  assert.equal(updatedLoan.balance, 100);

  const invalidLoan = await fetch(`${baseUrl}/api/loans`, {
    method: "POST",
    headers: { ...headers, Cookie: firstCookie },
    body: JSON.stringify({
      direction: "lent",
      counterparty: "Sam",
      amount: 10,
      loanDate: "2026-02-30",
    }),
  });
  assert.equal(invalidLoan.status, 400);
});

test("shares a workspace with an existing account without exposing other workspaces", async () => {
  const headers = { "Content-Type": "application/json" };
  const ownerRegistration = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email: `workspace-owner-${Date.now()}@example.com`,
      password: "correct-horse-battery",
    }),
  });
  const ownerCookie = ownerRegistration.headers.get("set-cookie").split(";")[0];
  const memberEmail = `workspace-member-${Date.now()}@example.com`;
  const memberRegistration = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email: memberEmail, password: "correct-horse-battery" }),
  });
  const memberCookie = memberRegistration.headers.get("set-cookie").split(";")[0];

  const ownerWorkspaces = await fetch(`${baseUrl}/api/workspaces`, {
    headers: { Cookie: ownerCookie },
  });
  const personalWorkspace = (await ownerWorkspaces.json()).workspaces[0];
  const createWorkspace = await fetch(`${baseUrl}/api/workspaces`, {
    method: "POST",
    headers: { ...headers, Cookie: ownerCookie },
    body: JSON.stringify({ name: "Family ledger" }),
  });
  assert.equal(createWorkspace.status, 201);
  const sharedWorkspace = (await createWorkspace.json()).workspace;

  const addMember = await fetch(`${baseUrl}/api/workspaces/${sharedWorkspace.id}/members`, {
    method: "POST",
    headers: {
      ...headers,
      Cookie: ownerCookie,
      "X-Workspace-Id": String(sharedWorkspace.id),
    },
    body: JSON.stringify({ email: memberEmail.toUpperCase() }),
  });
  assert.equal(addMember.status, 201);
  assert.equal((await addMember.json()).memberCount, 2);

  const invitedEmail = `workspace-invite-${Date.now()}@example.com`;
  const invitationResponse = await fetch(`${baseUrl}/api/workspaces/${sharedWorkspace.id}/invitations`, {
    method: "POST",
    headers: {
      ...headers,
      Cookie: ownerCookie,
      "X-Workspace-Id": String(sharedWorkspace.id),
    },
    body: JSON.stringify({ email: invitedEmail }),
  });
  assert.equal(invitationResponse.status, 201);
  const invitation = await invitationResponse.json();
  const firstToken = new URL(invitation.invitationUrl, "http://localhost").searchParams.get("invite");
  assert(firstToken);

  const renewedInvitationResponse = await fetch(`${baseUrl}/api/workspaces/${sharedWorkspace.id}/invitations`, {
    method: "POST",
    headers: {
      ...headers,
      Cookie: ownerCookie,
      "X-Workspace-Id": String(sharedWorkspace.id),
    },
    body: JSON.stringify({ email: invitedEmail }),
  });
  assert.equal(renewedInvitationResponse.status, 201);
  const renewedInvitation = await renewedInvitationResponse.json();
  const token = new URL(renewedInvitation.invitationUrl, "http://localhost").searchParams.get("invite");
  assert(token);
  assert.notEqual(token, firstToken);
  assert.equal(
    (await fetch(`${baseUrl}/api/workspace-invitations/${firstToken}`)).status,
    410,
  );

  const invitationDetailsResponse = await fetch(`${baseUrl}/api/workspace-invitations/${token}`);
  assert.equal(invitationDetailsResponse.status, 200);
  assert.deepEqual((await invitationDetailsResponse.json()).invitation, {
    email: invitedEmail,
    workspaceName: sharedWorkspace.name,
    expiresAt: renewedInvitation.expiresAt,
  });

  const wrongInviteEmail = await fetch(`${baseUrl}/api/auth/register-invitation`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email: `wrong-${invitedEmail}`,
      password: "correct-horse-battery",
      token,
    }),
  });
  assert.equal(wrongInviteEmail.status, 400);

  const invitedRegistration = await fetch(`${baseUrl}/api/auth/register-invitation`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email: invitedEmail,
      password: "correct-horse-battery",
      token,
    }),
  });
  assert.equal(invitedRegistration.status, 201);
  const invitedUser = await invitedRegistration.json();
  assert.equal(invitedUser.workspaceId, sharedWorkspace.id);
  const invitedCookie = invitedRegistration.headers.get("set-cookie").split(";")[0];
  const acceptedInvitation = await fetch(`${baseUrl}/api/workspace-invitations/${token}`);
  assert.equal(acceptedInvitation.status, 410);

  const invitedWorkspaceLoans = await fetch(`${baseUrl}/api/loans`, {
    headers: { Cookie: invitedCookie, "X-Workspace-Id": String(sharedWorkspace.id) },
  });
  assert.equal(invitedWorkspaceLoans.status, 200);

  const memberWorkspaces = await fetch(`${baseUrl}/api/workspaces`, {
    headers: { Cookie: memberCookie },
  });
  const memberWorkspaceIds = (await memberWorkspaces.json()).workspaces.map((workspace) => workspace.id);
  assert(memberWorkspaceIds.includes(sharedWorkspace.id));
  assert.equal(memberWorkspaceIds.length, 2);

  const unknownAccount = await fetch(`${baseUrl}/api/workspaces/${sharedWorkspace.id}/members`, {
    method: "POST",
    headers: {
      ...headers,
      Cookie: ownerCookie,
      "X-Workspace-Id": String(sharedWorkspace.id),
    },
    body: JSON.stringify({ email: "not-registered@example.com" }),
  });
  assert.equal(unknownAccount.status, 404);

  const mismatchedWorkspace = await fetch(`${baseUrl}/api/workspaces/${personalWorkspace.id}/members`, {
    method: "POST",
    headers: {
      ...headers,
      Cookie: memberCookie,
      "X-Workspace-Id": String(sharedWorkspace.id),
    },
    body: JSON.stringify({ email: `workspace-outsider-${Date.now()}@example.com` }),
  });
  assert.equal(mismatchedWorkspace.status, 403);

  const addLoan = await fetch(`${baseUrl}/api/loans`, {
    method: "POST",
    headers: {
      ...headers,
      Cookie: memberCookie,
      "X-Workspace-Id": String(sharedWorkspace.id),
    },
    body: JSON.stringify({
      direction: "borrowed",
      counterparty: "Taylor",
      amount: 80,
      loanDate: "2026-10-10",
    }),
  });
  assert.equal(addLoan.status, 201);

  const ownerSharedLoans = await fetch(`${baseUrl}/api/loans`, {
    headers: { Cookie: ownerCookie, "X-Workspace-Id": String(sharedWorkspace.id) },
  });
  assert.equal((await ownerSharedLoans.json()).loans.length, 1);
  const ownerPersonalLoans = await fetch(`${baseUrl}/api/loans`, {
    headers: { Cookie: ownerCookie, "X-Workspace-Id": String(personalWorkspace.id) },
  });
  assert.deepEqual((await ownerPersonalLoans.json()).loans, []);

  const outsiderRegistration = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email: `workspace-outsider-${Date.now()}@example.com`,
      password: "correct-horse-battery",
    }),
  });
  const outsiderCookie = outsiderRegistration.headers.get("set-cookie").split(";")[0];
  const forbidden = await fetch(`${baseUrl}/api/loans`, {
    headers: { Cookie: outsiderCookie, "X-Workspace-Id": String(sharedWorkspace.id) },
  });
  assert.equal(forbidden.status, 403);

  const duplicateMember = await fetch(`${baseUrl}/api/workspaces/${sharedWorkspace.id}/members`, {
    method: "POST",
    headers: {
      ...headers,
      Cookie: ownerCookie,
      "X-Workspace-Id": String(sharedWorkspace.id),
    },
    body: JSON.stringify({ email: memberEmail }),
  });
  assert.equal(duplicateMember.status, 409);

  const populatedWorkspaceDelete = await fetch(`${baseUrl}/api/workspaces/${sharedWorkspace.id}`, {
    method: "DELETE",
    headers: {
      Cookie: memberCookie,
      "X-Workspace-Id": String(sharedWorkspace.id),
    },
  });
  assert.equal(populatedWorkspaceDelete.status, 409);
  const preservedLoans = await fetch(`${baseUrl}/api/loans`, {
    headers: { Cookie: ownerCookie, "X-Workspace-Id": String(sharedWorkspace.id) },
  });
  assert.equal((await preservedLoans.json()).loans.length, 1);

  const emptyWorkspaceResponse = await fetch(`${baseUrl}/api/workspaces`, {
    method: "POST",
    headers: { ...headers, Cookie: ownerCookie },
    body: JSON.stringify({ name: "Empty shared workspace" }),
  });
  const emptyWorkspace = (await emptyWorkspaceResponse.json()).workspace;
  const addEmptyWorkspaceMember = await fetch(`${baseUrl}/api/workspaces/${emptyWorkspace.id}/members`, {
    method: "POST",
    headers: {
      ...headers,
      Cookie: ownerCookie,
      "X-Workspace-Id": String(emptyWorkspace.id),
    },
    body: JSON.stringify({ email: memberEmail }),
  });
  assert.equal(addEmptyWorkspaceMember.status, 201);

  const memberDeletesWorkspace = await fetch(`${baseUrl}/api/workspaces/${emptyWorkspace.id}`, {
    method: "DELETE",
    headers: {
      Cookie: memberCookie,
      "X-Workspace-Id": String(emptyWorkspace.id),
    },
  });
  assert.equal(memberDeletesWorkspace.status, 204);
  const ownerWorkspacesAfterDelete = await fetch(`${baseUrl}/api/workspaces`, {
    headers: { Cookie: ownerCookie },
  });
  assert(!(await ownerWorkspacesAfterDelete.json()).workspaces.some(
    (workspace) => workspace.id === emptyWorkspace.id,
  ));
  const memberWorkspacesAfterDelete = await fetch(`${baseUrl}/api/workspaces`, {
    headers: { Cookie: memberCookie },
  });
  assert(!(await memberWorkspacesAfterDelete.json()).workspaces.some(
    (workspace) => workspace.id === emptyWorkspace.id,
  ));

  const removedWorkspaceAccess = await fetch(`${baseUrl}/api/loans`, {
    headers: { Cookie: ownerCookie, "X-Workspace-Id": String(emptyWorkspace.id) },
  });
  assert.equal(removedWorkspaceAccess.status, 403);
});

test("reports workspace payment history by user and across all users", async () => {
  const headers = { "Content-Type": "application/json" };
  const accounts = await Promise.all(["owner", "member", "outsider"].map(async (role) => {
    const email = `payment-report-${role}-${Date.now()}@example.com`;
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email, password: "correct-horse-battery" }),
    });
    assert.equal(response.status, 201);
    return { email, cookie: response.headers.get("set-cookie").split(";")[0] };
  }));
  const [owner, member, outsider] = accounts;
  const workspaceResponse = await fetch(`${baseUrl}/api/workspaces`, {
    method: "POST",
    headers: { ...headers, Cookie: owner.cookie },
    body: JSON.stringify({ name: "Payment history ledger" }),
  });
  const workspace = (await workspaceResponse.json()).workspace;
  const workspaceHeaders = { "X-Workspace-Id": String(workspace.id) };

  const addMember = await fetch(`${baseUrl}/api/workspaces/${workspace.id}/members`, {
    method: "POST",
    headers: { ...headers, Cookie: owner.cookie, ...workspaceHeaders },
    body: JSON.stringify({ email: member.email }),
  });
  assert.equal(addMember.status, 201);

  const loanResponse = await fetch(`${baseUrl}/api/loans`, {
    method: "POST",
    headers: { ...headers, Cookie: owner.cookie, ...workspaceHeaders },
    body: JSON.stringify({
      direction: "lent",
      counterparty: "Jordan Lee",
      amount: 100,
      loanDate: "2026-10-01",
    }),
  });
  const loan = (await loanResponse.json()).loan;

  for (const [account, amount, paymentDate] of [
    [owner, 20, "2026-10-12"],
    [member, 15, "2026-10-13"],
  ]) {
    const response = await fetch(`${baseUrl}/api/loans/${loan.id}/payments`, {
      method: "POST",
      headers: { ...headers, Cookie: account.cookie, ...workspaceHeaders },
      body: JSON.stringify({ amount, paymentDate }),
    });
    assert.equal(response.status, 201);
  }

  const reportResponse = await fetch(`${baseUrl}/api/reports/payments`, {
    headers: { Cookie: owner.cookie, ...workspaceHeaders },
  });
  assert.equal(reportResponse.status, 200);
  const report = await reportResponse.json();
  assert.deepEqual(report.members.map(({ email }) => email), [member.email, owner.email].sort());
  assert.deepEqual(report.payments.map(({ amount, recordedBy }) => [amount, recordedBy.email]), [
    [15, member.email],
    [20, owner.email],
  ]);

  const memberReport = await fetch(`${baseUrl}/api/reports/payments`, {
    headers: { Cookie: member.cookie, ...workspaceHeaders },
  });
  assert.deepEqual(await memberReport.json(), report);

  const privateReport = await fetch(`${baseUrl}/api/reports/payments`, {
    headers: { Cookie: outsider.cookie, ...workspaceHeaders },
  });
  assert.equal(privateReport.status, 403);
});
