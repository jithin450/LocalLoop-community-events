# LocalLoop

A community platform for discovering nearby events, joining activities, and organizing gatherings with trusted local organizers.

## Run & Operate

- `pnpm install --frozen-lockfile` — install the locked workspace dependencies
- `pnpm run typecheck` — check all workspace packages
- The `artifacts/localloop: web` workflow runs the frontend.
- The `artifacts/api-server: API Server` workflow runs the Express API; check it with `GET /api/healthz`.

## Required configuration

The frontend needs these values in Replit Secrets to enable sign-in and event data:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

The app currently uses Supabase directly from the frontend for authentication and data. The Express service currently exposes only its health endpoint; it does not replace the Supabase configuration.

For a new Supabase project, apply the checked-in schema with `pnpm --filter @workspace/db run setup:localloop`. This one-time command also requires `SUPABASE_DB_URL`, a database connection URI for that same Supabase project. `SUPABASE_DB_URL` is not needed by the running app.

## Stack

- pnpm workspaces, TypeScript, React, Vite
- Supabase authentication and data access from the LocalLoop frontend
- Express 5 API service with a health endpoint
- PostgreSQL/Drizzle workspace library
