# React + Node login

A small sign-in app with a React interface, an Express API,
SQLite persistence, scrypt password hashes, and HTTP-only cookie sessions.

Signed-in users also get a private loan ledger with lent and borrowed loans,
repayment tracking, a due-date calendar, and monthly activity reports. Amounts
are displayed in Philippine pesos (PHP) and stored as integer centavos.
Each account starts with a private workspace. Create additional workspaces,
switch between them, and add existing accounts to share a workspace. Adding a
member grants access immediately; the app does not send an email invitation.
Members can add loans and payments in workspaces they belong to; separate
workspaces remain isolated. Any member can remove an empty workspace for all
members. Workspaces with loans, or workspaces that would leave a member without
another workspace, cannot be removed.

## Requirements

- Node.js 22.5 or newer
- npm

## Run locally

```sh
npm install
npm run dev
```

Open the Vite URL shown in the terminal (usually `http://localhost:5173`).
The development server proxies API requests to `http://localhost:3001`.

To create a production build and serve the API:

```sh
npm run build
npm start
```

Set `NODE_ENV=production` when deploying over HTTPS so the session cookie is
marked `Secure`. The SQLite database defaults to `server/data/auth.sqlite`;
set `DATABASE_PATH` to store it elsewhere.

## API

- `POST /api/auth/register` — create an account with `{ "email", "password" }`
- `POST /api/auth/login` — start a session
- `GET /api/auth/me` — return the signed-in user
- `POST /api/auth/logout` — revoke the session
- `GET /api/workspaces` — list workspaces for the signed-in account
- `POST /api/workspaces` — create a workspace
- `POST /api/workspaces/:id/members` — add an existing account by email
- `DELETE /api/workspaces/:id` — remove an empty workspace for all members
- `GET /api/loans` — list loans and payments for the selected workspace
- `POST /api/loans` — add a loan with direction, counterparty, amount, loan date,
  optional due date, and optional notes
- `POST /api/loans/:id/payments` — record a payment against an outstanding loan

Passwords must be 8–128 characters. Session tokens are random, stored in the
database as SHA-256 hashes, and sent in HTTP-only, same-site cookies.
Loan endpoints require a valid session and workspace membership. Send the
selected workspace ID in the `X-Workspace-Id` header; the server rejects access
to workspaces the account has not joined. Existing single-user loan records are
migrated into their owner's personal workspace on startup.

Run the API tests with `npm test`.
