# Task Decomposition App — Implementation Specification

Status: Prototype specification  
Version: 0.1  
Date: 2026-07-27

## 1. Product Summary

Build a local, single-user web application that turns a planning brief into a strictly ordered task tree with the help of a local Ollama model. Users can decompose any task, optimize a selected subtree, collapse excessive decomposition, edit every semantic field inline, undo or redo changes, and import or export the semantic tree as JSON.

The application must materialize model changes while the model is working. Tasks appear as they are added, existing fields are highlighted when revised, structural edits re-layout the graph, and rejected edits, retries, validation errors, cancellation, and rollback are visible in an activity panel.

The prototype describes Primitive Task Operators but never executes them.

## 2. Goals

1. Turn a root planning brief into an understandable ordered Task Tree.
2. Let the user recursively decompose any task using the full plan as context.
3. Make model-driven changes observable before the complete response finishes.
4. Distinguish Compound, Primitive, and Unresolved Tasks visually.
5. Let the user correct the model through inline editing, scoped optimization, Collapse Task, undo, and redo.
6. Preserve task semantics in a portable JSON representation that excludes presentation layout.
7. Run locally and privately against an Ollama model optimized for the target Mac.

## 3. Non-Goals

- Executing scripts, tools, shell commands, HTTP requests, or LLM Operators.
- Parallel task semantics.
- Conditional branches, alternate Methods, or multiple decomposition strategies.
- A general DAG editor or cross-tree dependency edges.
- Collaboration, authentication, cloud persistence, or a database.
- Saving node coordinates or viewport state in exported JSON.
- Arbitrary task deletion, Remove and Fold, or subtree promotion.
- Displaying or persisting raw model chain-of-thought.

## 4. Ubiquitous Language

### Task Tree

The complete exported planning artifact. It has exactly one Root Task.

### Root Task

The Task that holds the planning brief. It uniquely contains Goals. Its Description contains domain context such as startup details, audience, constraints, and existing assets.

### Task

A unit of intended work with a Title, Description, Inputs, and Outputs.

### Compound Task

A Task with a Decomposition. Its work is fulfilled by its ordered children, so it cannot also have an Operator.

### Decomposition

The ordered list of direct subtasks belonging to a Compound Task. Child array order is execution order.

### Primitive Task

A childless Task with one declared Operator. It is directly actionable without first deciding which additional tasks or structural stages are required.

A Primitive Task may still involve bounded local judgment. For example, `draft-hero-copy` can require creative choices while remaining directly actionable. `design-marketing-site` is not Primitive because it requires further planning and structural decisions.

### Unresolved Task

A childless Task without an Operator. It has not yet been made Primitive or decomposed further.

### Artifact Label

A Title Case semantic label in a Task's Inputs or Outputs, such as `Startup Brief`, `Hero Copy`, or `Published Website`. Matching labels express data flow without JSON Schema types or graph edges.

### Executor

What could directly perform a Primitive Task:

- `llm`
- `deterministic`

The prototype only describes the Executor and never invokes it.

### Operator

A concise kebab-case action identifier describing how a Primitive Task could be performed, such as `draft-hero-copy`, `extract-brand-colors`, or `run-accessibility-audit`.

### Decompose

Use the model to turn the selected Task into an ordered subtree. Decomposing a Primitive Task removes its Operator inside the pending transaction before children are added.

### Optimize Subtree

Use the model to revise the selected Task and its descendants. The model receives the complete Task Tree as read-only context but cannot change ancestors, siblings of the selected Task, or unrelated branches.

### Collapse Task

Keep the selected Compound Task, stage all of its descendants for removal, and use the model to consolidate useful descendant detail into the selected Task. Siblings and ancestors remain unchanged.

The collapsed Task becomes Primitive when the model can declare a defensible direct Operator. Otherwise it becomes Unresolved. Collapse is permanently semantic, not merely visual, but is fully undoable.

### Run

One Decompose, Optimize Subtree, or Collapse Task operation. A successful Run commits as one undoable transaction. A failed or cancelled Run commits nothing.

### Attempt

One model-generation cycle within a Run. A Run permits an initial Attempt plus two automatic retries.

## 5. Domain Model

The Task kind is derived rather than stored:

- `children.length > 0` and no `operator` means Compound.
- `children.length === 0` and `operator` exists means Primitive.
- `children.length === 0` and no `operator` means Unresolved.
- Children and an Operator on the same Task is invalid.

```ts
type Executor = "llm" | "deterministic";

interface Operator {
  executor: Executor;
  name: string; // kebab-case
}

interface Task {
  id: string;
  title: string;
  description: string;
  inputs: string[];  // Title Case Artifact Labels
  outputs: string[]; // Title Case Artifact Labels
  operator?: Operator;
  children: Task[];  // semantic execution order
}

interface RootTask extends Task {
  goals: string[];
}

interface TaskTree {
  schemaVersion: 1;
  root: RootTask;
}
```

Only the Root Task may contain `goals`. IDs are application-generated UUIDs and remain stable across editing, export, and import. Canvas positions, colors, selection, highlights, run state, and undo history are not exported.

### Example Export

```json
{
  "schemaVersion": 1,
  "root": {
    "id": "84b64789-544c-4c57-ad86-54be526fc497",
    "title": "Create a Marketing Website",
    "description": "Create a marketing website for a developer tooling startup...",
    "goals": [
      "Explain the product clearly",
      "Convert qualified visitors into demo requests"
    ],
    "inputs": [
      "Startup Brief"
    ],
    "outputs": [
      "Published Marketing Website"
    ],
    "children": [
      {
        "id": "f612625d-dca0-47c3-86dc-61d9301ce3df",
        "title": "Draft Hero Copy",
        "description": "Draft the headline, supporting copy, and primary call to action.",
        "inputs": [
          "Startup Brief"
        ],
        "outputs": [
          "Hero Copy"
        ],
        "operator": {
          "executor": "llm",
          "name": "draft-hero-copy"
        },
        "children": []
      }
    ]
  }
}
```

## 6. Functional Requirements

### 6.1 Root Brief

- A new tree begins with one editable Root Task.
- The Root Task exposes Title, Description, Goals, Inputs, and Outputs.
- Goals are an ordered list of plain-text outcomes.
- The primary Root action is Decompose.

### 6.2 Task Rendering

Each Task card shows:

- Title
- Description
- Input Artifact Labels
- Output Artifact Labels
- Derived Task kind
- Executor and Operator when Primitive
- Decompose action
- Optimize action
- Collapse action when Compound

Suggested semantic colors:

- Compound: indigo
- Primitive: amber
- Unresolved: slate

Run feedback is an overlay rather than another semantic color:

- Existing revised fields: green highlight
- Newly added Tasks: entrance pulse
- Descendants staged for Collapse: red treatment
- Rejected edits: activity-panel error, without applying the edit

### 6.3 Inline Editing

- Clicking any semantic field turns it into an appropriate text control.
- Enter or blur commits a single undoable edit.
- Escape cancels the edit.
- Inputs, Outputs, and Goals support adding, editing, deleting, and reordering list entries.
- Editing an Operator to empty removes it and makes the childless Task Unresolved.
- Adding a child to a Primitive Task clears its Operator.
- User edits cannot create a Task with both children and an Operator.

### 6.4 Decompose

- Decompose is available on every Task.
- The backend receives the complete tree and target Task ID.
- The complete tree is model-readable context.
- The model may mutate only the target and descendants created during the Run.
- Existing ancestors, siblings, and unrelated branches are immutable.
- The model creates ordered children, revises their fields, and declares Operators for Primitive leaves.
- Unresolved leaves are allowed when the Run reaches its budget or the model cannot defend a direct Operator.
- Decomposing an existing Primitive Task clears its Operator within the draft transaction.

### 6.5 Optimize Subtree

- Optimize is available on every Task.
- The selected Task and its descendants form the writable scope.
- The entire Task Tree and Root Goals are read-only context.
- The model may revise Tasks, add subtasks, reorder or reparent descendants within scope, declare Operators, and Collapse Tasks within scope.
- The optimization root cannot be moved outside its original position.
- No ancestor, external sibling, or unrelated branch may change.
- Existing changed fields remain highlighted green until the Run completes or rolls back.

### 6.6 Collapse Task

- Collapse is available only on a Compound Task.
- The selected Task survives with the same ID and tree position.
- Every descendant is staged for removal and shown in red.
- Ancestors and siblings are frozen.
- The model receives Root Goals, ancestor context, the selected subtree, sibling summaries, and relevant Artifact Labels.
- The model may revise the selected Task's Title, Description, Inputs, and Outputs.
- The model should declare a direct Operator when the collapsed Task can be Primitive.
- If a direct Operator is not defensible, the selected Task is left Unresolved.
- `finish_run` validates the revised Task before descendants are actually removed.
- Success deletes the descendants and commits one undo entry.
- Failure or cancellation restores the complete original subtree.

There is no general delete, Remove and Fold, or promote-children operation in the prototype.

### 6.7 Undo and Redo

- Every committed inline edit is one history entry.
- Every successful model Run is one history entry, regardless of the number of streamed mutations.
- In-progress changes live in a draft overlay and never enter history.
- Failed and cancelled Runs discard the overlay and leave history unchanged.
- Undoing Collapse restores the complete former subtree.
- Importing a file replaces the current tree after confirmation and clears undo history.

### 6.8 Import and Export

- Export downloads the committed Task Tree as UTF-8 JSON.
- Export never includes an in-progress overlay.
- Suggested filename: `<root-title>-task-tree.json`.
- Import accepts `.json`, validates the complete document, and replaces the tree only after validation succeeds.
- Invalid imports show path-specific errors and do not partially alter the current tree.
- Enforce a reasonable prototype file-size limit, initially 5 MB.
- No database or automatic project persistence is included.

## 7. Model and Runtime Configuration

Target hardware:

- Apple M2 Max
- 32 GB unified memory
- macOS

Default model:

```text
gemma4:26b-mlx
```

Default configuration:

```text
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_MODEL=gemma4:26b-mlx
OLLAMA_NUM_CTX=32768
```

The 18 GB MLX model is the Apple Silicon default. Keep the model and context configurable because practical speed depends on prompt size, quantization, and installed Ollama version. Do not attempt to allocate the advertised 256K context on this 32 GB machine by default.

At startup, the server checks Ollama availability and whether the configured model is installed. A missing model produces a clear local setup instruction:

```sh
ollama pull gemma4:26b-mlx
```

The application must not silently download a multi-gigabyte model.

Model reasoning may be enabled for planning quality, but raw reasoning is neither sent to the browser nor stored. The visible activity feed is built from domain mutations, validation, and retry events.

## 8. LLM Tool Surface

The model receives domain tools rather than generic node, edge, or JSON Patch operations.

### 8.1 `add_subtask`

```ts
add_subtask({
  parent_id: string,
  after_sibling_id?: string | null,
  title: string
})
```

Creates an Unresolved Task with an application-generated ID and links it to the parent atomically. Omitting `after_sibling_id` appends. `null` inserts first. The tool result returns the new Task ID.

If the parent was Primitive, the server clears its Operator within the draft transaction before adding the child.

### 8.2 `revise_task`

```ts
revise_task({
  task_id: string,
  title?: string,
  description?: string,
  inputs?: string[],
  outputs?: string[],
  goals?: string[]
})
```

Replaces only supplied fields. At least one revisable field is required. `goals` is rejected unless `task_id` is the Root Task and the Root is inside the writable scope.

The model should use semantic field-sized revisions rather than character append calls. This keeps the tool surface understandable and allows precise per-field highlights.

### 8.3 `declare_operator`

```ts
declare_operator({
  task_id: string,
  executor: "llm" | "deterministic",
  operator: string
})
```

Creates or replaces the Operator of a childless Task. The call is rejected when the Task has children or when the Operator is not kebab-case.

### 8.4 `move_subtree`

```ts
move_subtree({
  task_id: string,
  new_parent_id: string,
  after_sibling_id?: string | null
})
```

Available only during Optimize Subtree. Reorders or reparents a Task and all descendants inside the writable scope. The server rejects cycles, attempts to move the optimization root, and moves across the scope boundary.

### 8.5 `collapse_task`

```ts
collapse_task({
  task_id: string
})
```

Available during Optimize Subtree. Stages all descendants of the selected Compound Task for removal while keeping the Task itself. The Task becomes Unresolved until the model revises it and optionally declares an Operator.

For a user-initiated Collapse Task Run, the target is staged by the controller before the first model turn, so the model does not need to call this tool.

### 8.6 `finish_run`

```ts
finish_run()
```

Signals that the model considers the writable scope complete. The server runs structural validation and then semantic validation. The Run commits only after validation succeeds.

### 8.7 Tool Rules

- The model never creates persistent IDs.
- A Task and its parent link are created atomically.
- The model never receives or mutates layout coordinates.
- Each call is validated before application.
- A rejected call produces no draft mutation.
- The exact rejection is returned to the model and surfaced in the UI.
- Tool calls are applied in received order; parallel task semantics are not inferred.
- Tools unavailable for the current action are not included in the model request.

## 9. Prompt Contract

Every planning prompt must include the shared vocabulary and these rules:

1. Produce a strictly ordered tree.
2. Do not create parallel, conditional, or alternative execution paths.
3. A Compound Task must have ordered children and no Operator.
4. A Primitive Task must be childless and have one direct Operator.
5. A Task is not Primitive when its executor must first decide what additional tasks or structural stages are required.
6. Bounded local judgment within a direct action is allowed.
7. Prefer terms from the user's brief and established domain terminology.
8. Do not introduce abstractions merely to organize the plan.
9. Reuse existing Artifact Labels instead of creating synonymous variants.
10. Respect the writable scope and treat the remainder of the tree as read-only context.
11. Use only tools to mutate the tree.
12. End by calling `finish_run`.

Action prompts add the target, writable scope, Root Goals, relevant ancestor path, tree context, and budgets.

## 10. Run, Streaming, Validation, and Retry Model

### 10.1 Draft Overlay

The browser keeps the committed Task Tree separate from a Run overlay. Streamed domain events update the overlay only. This permits live rendering without risking partial commits.

State flow:

```text
committed
  -> generating attempt
  -> validating
  -> committed as one undo entry

or

committed
  -> generating attempt
  -> rejected / failed / cancelled
  -> overlay discarded
  -> original committed tree restored
```

For the prototype, semantic tree editing is locked while a Run is active. The user may pan, zoom, inspect fields, open the activity panel, or cancel the Run.

### 10.2 Semantic Streaming

Ollama tool calls are handled at semantic call granularity:

- `add_subtask` immediately adds and links a visible Task.
- `revise_task` streams field revisions to the relevant card.
- `declare_operator` immediately changes a leaf to Primitive.
- `move_subtree` triggers animated re-layout.
- `collapse_task` marks descendants as pending removal.

When a complete field value arrives, the UI reveals the genuine value using a short typewriter animation while later model work continues. The model is not burdened with character-append tools.

### 10.3 Per-Call Validation

Before a mutation reaches the overlay, validate:

- Tool argument schema
- Writable scope
- Referenced IDs
- Parent and sibling relationships
- Cycle prevention
- Root-only Goals
- Task/Operator mutual exclusion
- Artifact Label format
- Operator format

A rejected call is logged, shown in the activity panel, and returned to the model for correction. After three rejected calls in one Attempt, fail the Attempt.

### 10.4 `finish_run` Structural Validation

Validate the entire draft tree:

- Exactly one Root Task
- Unique stable IDs
- No cycles
- Every non-root Task has one parent
- Ordered child arrays
- No Task contains both children and an Operator
- Every Operator has a valid Executor and kebab-case name
- Goals exist only on the Root
- Scope boundaries were respected
- Title, Description, Input, and Output field shapes are valid
- Artifact Labels use the agreed representation

Unresolved Tasks are valid and produce warnings rather than failure.

### 10.5 Semantic Validation

After structural validation, run a read-only structured model audit. It checks:

- The writable subtree remains aligned with Root Goals.
- Ordered children plausibly cover their Compound parent.
- Primitive Tasks are directly actionable without another planning stage.
- Artifact flow is coherent.
- No unnecessary organizational abstractions were introduced.
- Decompose and Optimize did not change frozen Tasks.
- Collapse preserved the selected Task's useful intent while leaving siblings unchanged.

The audit returns a machine-readable verdict and issues. It receives no mutation tools.

### 10.6 Retries and Failure

- Permit three Attempts total: one initial Attempt and two retries.
- Every Attempt starts from the original committed snapshot, not the previous failed overlay.
- Stream `attempt.started`, validation failures, and retry events to the browser.
- Retry recoverable model, transport, tool-budget, and validation failures.
- Use short bounded backoff between retries.
- A user cancellation prevents further retries.
- On final failure, discard the overlay, restore the original tree, and leave undo history unchanged.
- Retain the Run's diagnostic activity log in the UI until dismissed or another Run starts.

## 11. Domain Event Protocol

Every event includes:

```ts
interface RunEvent<T> {
  runId: string;
  attempt: number;
  sequence: number;
  timestamp: string;
  type: string;
  payload: T;
}
```

Required event types:

- `run.started`
- `attempt.started`
- `task.added`
- `task.revised`
- `operator.declared`
- `subtree.moved`
- `collapse.staged`
- `tool.rejected`
- `validation.started`
- `validation.failed`
- `validation.warning`
- `attempt.failed`
- `attempt.retrying`
- `run.completed`
- `run.failed`
- `run.cancelled`

Events are ordered by `sequence`. The server retains the event buffer for the life of the Run so a briefly disconnected local client can resume from the last SSE event ID.

## 12. Application Architecture

### 12.1 Repository Structure

```text
apps/
  web/       React application
  server/    Fastify API and Ollama orchestration
packages/
  domain/    Shared schemas, invariants, tools, events, and tree operations
```

Use a pnpm workspace with TypeScript throughout.

### 12.2 Frontend

- React
- TypeScript
- Vite
- `@xyflow/react`
- Dagre auto-layout
- shadcn/ui
- Radix primitives
- Tailwind CSS
- Zustand
- Immer patches
- Zod shared domain schemas

React Flow renders and interacts with the tree; it is not the source of semantic truth. Dagre computes a top-to-bottom layout after structural mutations. Layout changes are animated and never exported.

### 12.3 Backend

- Node.js
- TypeScript
- Fastify
- Official Ollama JavaScript client
- Zod
- Server-Sent Events
- In-memory Run registry and event buffers

The backend binds to `127.0.0.1` by default. In production mode it serves the built frontend from the same origin. In development, Vite proxies API requests to Fastify.

### 12.4 HTTP API

```text
GET    /api/health
POST   /api/runs
GET    /api/runs/:runId/events
DELETE /api/runs/:runId
```

`POST /api/runs`:

```ts
interface StartRunRequest {
  action: "decompose" | "optimize" | "collapse";
  tree: TaskTree;
  targetTaskId: string;
}
```

The response is `202 Accepted` with a `runId`. `run.completed` contains the validated final Task Tree. The frontend verifies that the completion corresponds to the locked base tree, commits it as one history entry, and removes the overlay.

`DELETE /api/runs/:runId` cancels Ollama generation through an `AbortController`, emits `run.cancelled`, and discards server Run state after the event buffer retention period.

## 13. User Interface

### Main Canvas

- Editable Root Task at the top.
- Top-to-bottom ordered Task Tree.
- Smooth pan and zoom.
- Fit-to-tree action.
- Visual indicators of active changes.
- Animated re-layout after structural events.
- Edges communicate parentage only, not parallelism.
- Modern Miro-like feel.

### Toolbar

- New Tree
- Import JSON
- Export JSON
- Undo
- Redo
- Fit View
- Model/Ollama health/status indicator

### Node Actions

- Decompose
- Optimize (node and subnodes)
- Collapse when Compound
- Inline field editing

### Activity Panel

Show user-facing descriptions rather than raw tool JSON:

- Current action and target
- Task and field mutations
- Rejected edits and reasons
- Validation progress
- Warnings
- Retry countdown
- Final failure
- Cancel control

Do not display raw chain-of-thought.

## 14. Safety and Locality

- Bind the server to localhost.
- Do not expose arbitrary filesystem, shell, network, or script tools to the model.
- Treat imported strings as text; never render imported HTML.
- Validate all imported files and model tool arguments.
- Limit import size and Run budgets.
- Do not silently download models.
- Do not execute described Operators.
- Keep all tree data local unless the user explicitly exports a file.

## 15. Testing Strategy

### Unit Tests

- Task-kind derivation
- Tree invariants
- Scope enforcement
- Artifact and Operator validation
- Add, revise, move, and Collapse operations
- Collapse preserves the selected Task ID and removes only descendants
- Undo/redo patch behavior
- JSON import/export round trips

### Contract Tests

- LLM tool schemas
- Tool rejection responses
- Domain event shapes and ordering
- Run completion and rollback

### Integration Tests

Use a deterministic fake Ollama stream to test:

- Progressive node creation
- Field revisions and highlights
- Rejected tool correction
- Structural validation failure
- Semantic validation failure
- Retry success
- Exhausted retries and rollback
- Cancellation
- SSE reconnection

### End-to-End Tests

- Create a startup marketing brief and decompose it in browser.
- Decompose an Unresolved or Primitive leaf.
- Optimize a middle subtree without changing external siblings.
- Collapse a Compound Task, inspect the staged UI, and commit.
- Undo Collapse and recover the full subtree.
- Edit fields inline and undo/redo.
- Export, start a new tree, import, and recover identical semantics.
- Observe and recover from a mocked three-attempt failure.

### Hardware Verification

On the target M2 Max:

- Verify `gemma4:26b-mlx` loads without memory pressure at 32K context.
- Record prompt-evaluation and generation tokens per second for representative Decompose, Optimize, and Collapse prompts.
- Compare with an already-installed compatible quantized 26B model only if the MLX build is unstable or unexpectedly slower.

## 16. Acceptance Criteria

The prototype is complete when:

1. A user can enter a Root Title, Description, Goals, Inputs, and Outputs.
2. Decompose creates and links visible Tasks incrementally through Ollama tool calls.
3. Every Task field is editable inline.
4. Compound, Primitive, and Unresolved Tasks are visually distinct.
5. Primitive Tasks show an Executor and Operator but cannot be executed.
6. Decompose is correctly scoped to the selected Task.
7. Optimize can revise only the selected subtree and highlights existing changed fields in green.
8. Collapse keeps the selected Task, removes only its descendants after validation, and is fully undoable.
9. No general delete or fold behavior exists.
10. Failed tool calls, validation errors, retry attempts, cancellation, and final rollback are visible.
11. A failed Run leaves the committed tree and undo history unchanged.
12. Undo and redo work for user edits and successful model Runs.
13. JSON export/import round-trips all semantic data and no layout data.
14. The app runs locally against `gemma4:26b-mlx` through Ollama.
15. No described Operator is executed.

## 17. Recommended Implementation Order

1. Create the shared domain package, schemas, invariants, tree operations, and JSON import/export.
2. Build the React Flow editor, Root brief, inline editing, derived styling, Dagre layout, and undo/redo.
3. Build the Fastify health endpoint, Ollama configuration, Run registry, and SSE transport.
4. Implement the agent loop and the six domain tools.
5. Add Decompose with live overlay events.
6. Add Optimize Subtree and strict scope enforcement.
7. Add Collapse Task and staged descendant removal.
8. Add structural and semantic validation, retries, cancellation, diagnostics, and rollback.
9. Complete automated tests and benchmark the model on the target Mac.
