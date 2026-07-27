# Task Tree

Task Tree is a local, single-user planning workspace that uses Gemma 4 through
Ollama to decompose complex work into a strictly ordered Task Tree. Model edits
materialize while a Run is in progress, validation and retries remain visible,
and only successful Runs enter undo history.

The implementation follows [SPEC.md](./SPEC.md).

## Requirements

- macOS on Apple Silicon
- Node.js 22.13 or newer
- Ollama 0.32 or newer
- The MLX build of Gemma 4 26B A4B

Install the configured model once:

```bash
ollama pull gemma4:26b-mlx
```

The model is approximately 18 GB. Task Tree checks for it but never downloads
it automatically.

## Start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The web client runs on
port 3000 and the localhost-only model service runs on port 8787.

Environment defaults are documented in `.env.example`. Copy them into a local
`.env` only when overriding the default Ollama host, model, context, or Run
budgets.

## Product Workflows

- Fill in the Root Brief's Title, Description, Goals, Inputs, and Outputs.
- Use **Decompose** on any Task to create an ordered subtree.
- Use **Optimize Subtree** to revise only the selected Task and descendants.
- Use **Collapse Task** to keep a Compound Task while removing excessive
  decomposition beneath it.
- Click any semantic field to edit it directly.
- Import or export semantic JSON; canvas positions are never exported.
- Use the Activity panel to inspect model mutations, rejected edits,
  validation, retries, cancellation, and rollback.

Task Tree describes Primitive Operators but never executes them.

## Architecture

```text
app/                 React and React Flow web client
server/              Fastify, Ollama orchestration, SSE, retries
packages/domain/     Shared schemas, invariants, tools, events
```

The browser keeps committed state separate from the active Run overlay.
Validated completion replaces the committed tree as one Immer patch entry.
Failure or cancellation discards the overlay without changing history.

## Verification

```bash
npm run test:unit
npm run lint
npm run build
npm test
```

The test suite covers Task Tree invariants, Collapse behavior, undo/redo,
streamed Run materialization, retries, rollback, and the production render.
