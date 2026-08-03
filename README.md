# Planbranch

Planbranch is a local, single-user planning workspace that uses a configurable
model runtime to decompose complex work into a strictly ordered Task Tree.
Model edits materialize while a Run is in progress, validation and retries
remain visible, and only successful Runs enter undo history.

The default runtime is the balanced `gpt-5.6-terra` model at `medium` reasoning
effort. On load, the Activity panel asks Codex for the models available to the
signed-in account and the reasoning efforts each model supports. It reuses the
local Codex CLI's ChatGPT login, so Runs use the Codex subscription rather than
OpenAI API credits.

The implementation follows [SPEC.md](./SPEC.md).

## Requirements

- macOS on Apple Silicon
- Node.js 22.13 or newer
- Codex CLI with at least one available coding model
- A ChatGPT-authenticated Codex session

Confirm the local authentication method:

```bash
codex login status
```

If needed, run `codex login` and choose ChatGPT sign-in. The health check rejects
API-key authentication by default so the app cannot silently consume API
credits.

## Start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The web client runs on
port 3000 and the localhost-only model service runs on port 8787.

Environment defaults are documented in `.env.example`. Copy them into a local
`.env` only when overriding the runtime command, provider, model, reasoning
effort, authentication mode, or Run budgets. The browser and server use
provider-neutral status shapes so future local or cloud adapters do not require
provider-specific UI changes.

## Product Workflows

- Fill in the Root Brief's Title, Description, Goals, Inputs, and Outputs.
- Use **Generate Goals & Inputs** to populate those Root fields from its Title
  and Description.
- Use **Decompose** on any Task to create an ordered subtree.
- Use **Optimize Subtree** to revise only the selected Task and descendants.
- Use **Collapse Task** to keep a Compound Task while removing excessive
  decomposition beneath it.
- Click any semantic field to edit it directly.
- Import or export semantic JSON; canvas positions are never exported.
- The committed tree and undo/redo history save automatically in this browser.
- Choose the model and supported reasoning effort from the Activity panel;
  that preference also saves in this browser.
- Each Run may create at most 12 Tasks and descend at most two levels below its
  target. Direct bounded transformations stop at an Operator instead of being
  decomposed into implementation trivia.
- Use the Activity panel to inspect model mutations, rejected edits,
  validation, retries, cancellation, and rollback.

Planbranch describes Primitive Operators but never executes them.

## Architecture

```text
app/                 React and React Flow web client
server/              Fastify, model-runtime orchestration, SSE, retries
packages/domain/     Shared schemas, invariants, tools, events
```

The browser keeps committed state separate from the active Run overlay.
Validated completion replaces the committed tree as one Immer patch entry.
Failure or cancellation discards the overlay without changing history.

Codex app-server receives the six domain operations as dynamic tools. Each
accepted tool call updates the Run overlay and SSE stream immediately; rejected
calls are returned to Codex for correction in the same turn. The model has a
read-only sandbox and is explicitly restricted from unrelated tools.

## Verification

```bash
npm run test:unit
npm run lint
npm run build
npm test
```

The test suite covers Task Tree invariants, Collapse behavior, undo/redo,
streamed Run materialization, retries, rollback, and the production render.
