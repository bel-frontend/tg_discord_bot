# AGENTS.md

Instructions for agents working in this repository.

## Project Overview

This is a Bun/TypeScript app for composing one Markdown post and publishing it
to selected Telegram and Discord channels. The backend lives in `src/`, the
frontend lives in `frontend/`, and shared HTTP/JSON types live in `shared/`.

Key areas:

- `index.ts` registers platform adapters and starts the HTTP server.
- `src/server.ts` contains the Bun.serve router, API routes, auth, drafts,
  uploads, and publications.
- `src/platforms/` contains platform adapters and the shared `Platform`
  contract.
- `src/converters/` contains Markdown conversion logic for platform-specific
  formats.
- `frontend/src/` contains the React + Vite SPA.
- `shared/types.ts` contains only types that cross the frontend/backend
  boundary.

## Commands

Use Bun as the primary runtime and package manager.

- Install dependencies: `bun install`
- Run the API and frontend in development: `bun run dev`
- Build the frontend into `public/`: `bun run build`
- Run the production-like process: `bun run start`
- Run all tests: `bun run test`
- Run backend tests only: `bun test src/*.test.ts`
- Run frontend tests only: `cd frontend && bun run test`
- Run the frontend dev server separately: `cd frontend && bun run dev`

Note: do not document or use `bun run web` unless that script is added to the
root `package.json`.

## Working Rules

- Do not commit `.env`, tokens, passwords, private keys, or real channel IDs
  unless the user explicitly asks for it.
- Use `.env.example` and `channels.example.json` for configuration examples.
- Do not overwrite unrelated work in the working tree. If a file is already
  modified, inspect it before editing and preserve changes unrelated to the
  task.
- Keep changes narrowly focused on the request. Avoid opportunistic refactors.
- When adding or changing behavior, add or update the relevant tests.
- After meaningful changes, run the smallest useful verification. For broad
  changes, run `bun run test`.

## Code Style

The project uses TypeScript, ESM, and a strict `tsconfig`.

- Follow `.prettierrc`:
  - 4 spaces;
  - semicolons;
  - single quotes;
  - trailing commas;
  - print width 80.
- Use ESM imports and keep the existing relative-import style.
- Avoid `any`. If it is unavoidable, keep its scope small and make the reason
  clear in code or tests.
- Keep runtime types and wire types separate:
  - `shared/types.ts` is only for shapes that actually cross HTTP/JSON;
  - MongoDB document shapes, `ObjectId`, `Date`, and adapter-internal contracts
    should stay in backend modules.
- Comments should explain non-obvious decisions, not restate the code.
- Prefer small functions with clear inputs and outputs.

## DRY And Architecture Principles

DRY matters in this project. Before adding new logic, check whether an existing
mechanism already exists in `src/`, `frontend/src/hooks/`, `frontend/src/lib/`,
or `shared/`.

- The system must stay modular and layered. Platform integrations, content
  conversion, API routing, persistence, and UI state should remain separate
  concerns with clear boundaries.
- Layering also means added modules must be independent from each other. A new
  platform module must not require changes inside existing platform modules or
  depend on their private implementation details.
- Put shared business logic in backend services or helpers, not duplicated
  route-handler blocks.
- Move stateful frontend logic into hooks when it is reused or makes a
  component hard to read.
- Do not duplicate platform-specific branching in the server or frontend. New
  platforms should integrate through the `Platform` interface and registry.
- Adding Threads, Twitter/X, or another network should mean adding a new
  platform module and registering it, not rewriting the app architecture.
- Content conversion belongs in converters/adapters, not in the UI.
- Backend validation is the source of truth. The UI may guide the user, but it
  must not be the only protection.
- When choosing between copying a block and adding a small helper, prefer the
  helper if it genuinely simplifies the code and does not create abstraction
  for its own sake.

## Backend

- API routes live in `src/server.ts`; move complex logic into nearby modules
  following the existing pattern (`drafts.ts`, `publications.ts`, `uploads.ts`).
- Use the existing auth helpers: `registerUser`, `loginUser`, and
  `requireAuth`.
- Keep API response shapes compatible with the frontend client.
- User-facing errors should be short and stable. Tests often assert exact
  messages.
- Keep upload type and size restrictions enforced on the backend.
- Do not add platform-specific branching to routes when the adapter/registry
  layer can own it.

## Frontend

- The frontend is React 18 + Vite. Components live in
  `frontend/src/components`, hooks in `frontend/src/hooks`, and utilities in
  `frontend/src/lib`.
- API calls should go through the existing `frontend/src/api.ts` helper.
- Preserve the existing auth model: JWT on the client, and any 401 clears the
  session.
- Use the existing `lucide-react` icon dependency.
- Keep the UI dense, clear, and free of unnecessary explanatory copy.
- Do not duplicate parsing or normalization across components. Extract a hook
  or helper when the same logic appears in more than one place.

## Platforms

To add a new social platform:

1. Implement the `Platform` interface from `src/platforms/types.ts`.
2. Add the adapter under `src/platforms/`.
3. Register it in `index.ts`.
4. Add Markdown conversion if the platform needs a special format.
5. Add tests for chunking, conversion, publish request handling, or registry
   behavior when shared behavior changes.

The frontend channel picker should receive new platforms through the API, with
no manual platform hardcoding in the UI.

Keep every platform integration self-contained. A platform module should own
its authentication/client setup, channel discovery, publishing, updating,
deleting, chunking constraints, and format conversion decisions. Shared code is
fine when behavior is genuinely common, but do not make one platform depend on
another platform's implementation details. Platform modules should communicate
with the rest of the app only through shared contracts such as `Platform`,
shared types, and explicit registry APIs.

## Tests

- Backend tests use `bun:test`.
- Frontend tests use Vitest + Testing Library.
- Tests should lock down user-visible behavior and edge cases, not simply
  repeat implementation details.
- Be careful with Bun `mock.module()`: it can affect the whole process-wide test
  run. If changing test names or ordering, run all backend tests together.
- When changing user-facing error messages, update tests and make sure the new
  wording is actually better for users.

## Configuration And Data

- `.env.example` is the source of truth for documenting environment variables.
- `channels.example.json` is the example shape for channel resources.
- `public/` is the frontend build output. Do not edit it by hand unless the
  task is specifically about static build artifacts.
- MongoDB stores users, drafts, uploads, publications, and channel resources.
  Do not change schema shapes without thinking through migration and backward
  compatibility.

## When Unsure

- Read the existing modules and tests first.
- Follow established repository patterns.
- Ask a question only when you cannot safely continue without the answer.
- For small tasks, prefer a minimal working change with verification over a new
  broad abstraction.
