# Todo App — Architecture Proposal (v0 for review)

**Status:** PROPOSAL — nothing implemented yet.
**Stack (per Product Owner decisions):** Vite + React 18 + TypeScript · Tailwind CSS · localStorage persistence.
**Open for review by the PO before any implementation.**

---

## 0. Design principles driving this plan

- **Backend-ready later without a rewrite.** We know an API is coming. So all
  persistence goes behind a small async **repository/interface seam** now, even though
  it's backed by localStorage. Swapping localStorage → HTTP later means touching one
  file + the wiring, not every component.
- **Fully asynchronous-looking state.** Components `await` loads, so the same code paths
  exercise real loading states today and real network latency tomorrow.
- **No logic hidden in JSX.** Filtering/search/derivation live in a selector layer and a
  hook, kept pure & unit-testable.
- **Explicit UI states.** Loading / error / empty / success are all *first-class* states,
  never implicit.

---

## 1. Component structure

```
App
└── TodoApp                 // page-level shell, wires providers + layout
    ├── <TodoProvider>      // context provider (holds state + actions)   [see §3]
    │
    ├── Header              // app title, search bar  (onChange -> search term)
    ├── TodoComposer        // "add task" input + submit button
    ├── FilterBar           // segmented control: All | Active | Completed
    │
    └── TodoList            // decides between loading / error / empty / rows
        ├── LoadingState
        ├── ErrorState      // shows message + Retry button
        ├── EmptyState      // distinct text when nothing at all vs. no search/filter matches
        └── TodoItem        // single row: checkbox, text, edit/delete actions
            └── TodoItemEdit // inline edit form (swap-in when editing)
```

**Responsibilities, coarsely:**
- `TodoComposer` — owns its local input state; dispatches `add` on submit.
- `TodoList` — **pure presentational** for rows; decides which state block to render.
- `TodoItem` — checkbox toggles `complete`; buttons switch it into `TodoItemEdit`; the edit
  form holds a local draft and commits/ cancels.
- `FilterBar` — controlled by the active filter; on change updates filter in state.
- `Header` — receives search term + change handler (fully controlled from above).

Rule: **Containers/state live high (in `TodoApp`/context), low-level presentational
components stay "dumb"** and receive data + callbacks via props.

---

## 2. Data model

A **Task** object — plain, serializable, versioned for future migrations:

```ts
// types.ts
export type TaskStatus = 'active' | 'completed';

export interface Task {
  id: string;          // nanoid / crypto.randomUUID()
  title: string;       // trimmed, non-empty
  status: TaskStatus;  // or `completed: boolean` — see open question below
  createdAt: number;   // epoch ms, for future sorting
  updatedAt: number;
  // reserved for later backend work:
  //  ownerId, dueDate, priority, tags  — deliberately NOT in v1
}

// One subtlety to keep in mind for the localStorage → API migration:
// the persisted shape (camelCase JSON here) will later become the wire shape.
// Keep field names stable; only ADD fields, never rename, once shipped.
```

**Choice to confirm:** `status: 'active' | 'completed'` vs `completed: boolean`.
I lean **`status`** (an enum) because it reads cleanly in filters (`status === 'active'`)
and extends to future states (e.g. `'archived'`). If you prefer boolean simplicity, say so.

---

## 3. State management approach

**Recommendation: React Context + a small reducer**, plus a repository seam for persistence.

- One `TodoContext` exposes `{ state, actions, status }`:
  - `state.tasks: Task[]`
  - `state.filter: 'all' | 'active' | 'completed'`
  - `state.search: string`
  - `actions`: `add(title)`, `update(id, patch)`, `remove(id)`, `toggleComplete(id)`,
    `setFilter(f)`, `setSearch(s)`, `reload()`
  - `status`: `'loading' | 'ready' | 'error'` + `errorMessage` (drives Loading/Error states)
- Internally uses `useReducer` for the task list + a couple of `useState` for
  filter/search (they're ephemeral, don't need reducer ceremony).
- Derived view = a **pure selector**:
  ```ts
  visibleTasks(tasks, filter, search): Task[]
  ```
  computes filtered + searched list. Kept out of the reducer so it's trivially testable.

**Persistence — the repository seam (§0):**
```ts
interface TaskRepository {
  load(): Promise<Task[]>;
  save(tasks: Task[]): Promise<void>;
}
class LocalStorageTaskRepository implements TaskRepository { ... }
```
- One `save` is debounced ~300ms; full list write is fine at this scale.
- Load happens once on mount → sets `status='loading'`, then `ready`/`error`.
- Later: `new HttpTaskRepository(baseUrl)` swaps in at the single wiring point. No
  component changes.

**Why not heavier options (Redux/Zustand/React Query)?** Overkill for this scope and they
add dependencies (rule 4). Context+reducer keeps deps at zero. If the data layer later
grows complex, the seam lets us introduce React Query without touching UI.

---

## 4. File structure

```
todo-app/
├─ index.html
├─ vite.config.ts
├─ tsconfig.json
├─ tailwind.config.js / postcss.config.js
├─ package.json
├─ src/
│  ├─ main.tsx                 // mounts <App/>
│  ├─ App.tsx                  // top-level providers + layout
│  ├─ index.css                // tailwind directives + base styles
│  │
│  ├─ components/
│  │  ├─ TodoApp.tsx
│  │  ├─ Header.tsx
│  │  ├─ TodoComposer.tsx
│  │  ├─ FilterBar.tsx
│  │  ├─ TodoList.tsx
│  │  ├─ TodoItem.tsx
│  │  ├─ TodoItemEdit.tsx
│  │  └─ states/
│  │     ├─ LoadingState.tsx
│  │     ├─ ErrorState.tsx
│  │     └─ EmptyState.tsx
│  │
│  ├─ context/
│  │  └─ TodoContext.tsx       // provider + useTodo hook + reducer
│  │
│  ├─ data/
│  │  ├─ TaskRepository.ts     // interface (the seam)
│  │  └─ LocalStorageTaskRepository.ts
│  │
│  ├─ selectors/
│  │  └─ visibleTasks.ts       // pure filter+search
│  │
│  ├─ types.ts                 // Task, TaskStatus, Filter, ViewStatus
│  └─ hooks/
│     └─ useDebounce.ts        // debounce search & save
│
└─ tests/ (or co-located .test.ts)
   ├─ visibleTasks.test.ts
   └─ LocalStorageTaskRepository.test.ts
```

Conventions followed: feature-scoped folders (`components/`, `context/`, `data/`,
`selectors/`), barrel-free small modules, `use`-prefixed hooks, PascalCase components.

---

## 5. UI states & error handling (cross-cutting)

All four states are explicit in `TodoList`:
- **Loading:** skeleton rows / spinner while repository `load()` is pending.
- **Error:** readable message + **Retry** button (re-calls `reload()`); never swallowed.
  localStorage quota/parse errors surface here.
- **Empty:** *two variants* — (a) "No tasks yet — create your first one" when list is
  truly empty; (b) "No results for '<query>'" when filters/search match nothing.
- **Success:** the filtered list, always reflecting filter + search.

Inline form errors (e.g. empty title on submit) validate in `TodoComposer`/`TodoItemEdit`
and show a small message under the field — no silent drops.

**Responsive:** single mobile-first layout; toolbar/search wrap below ~640px; full width on
touch targets (≥44px). Tailwind responsive utilities only.

---

## 6. Scope guardrails (v1 — deliberately excluded)

Per PO requirements I'm not building these yet: real backend, auth, drag-and-drop
reordering, due dates, priorities, tags, undo, multi-select. The model has reserved
fields but the UI/logic won't reference them.

---

## 7. Proposed build order (each a small reviewable milestone)

1. Scaffold (Vite+React+TS+Tailwind) + types + repo seam + context skeleton.
2. Add + list + loading/empty states (localStorage).
3. Toggle complete, delete, edit.
4. FilterBar + visibleTasks selector + active/completed/all.
5. Search + debounce; distinct "no results" empty state.
6. Error states + Retry; polish responsive; unit tests for selector & repo.

---

## Open questions for you (Product Owner)

1. **`status` enum vs `completed: boolean`** on Task — I recommend `status`.
2. **Repo seam now or plain localStorage calls?** I recommend the seam now (§0) — it's a
   few lines extra and buys a clean backend swap. Confirm you want it.
3. Confirm **build order** above, or do you want a different slice first?

On your go-ahead (and answers to Q1–Q3), I'll start with **milestone 1 only**, name the
exact files I'm creating, and give you a test path when it's done.
