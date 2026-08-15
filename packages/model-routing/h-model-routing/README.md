# @deepseek-ai/dsh-h-model-routing

English | [中文](README.zh.md)

Hierarchical model routing for DSH. The plugin classifies each root-agent task and selects the configured Light or Expert model without changing the agent-loop driver.

## Behavior

- A level-1 Expert assessment classifies a new user task as SIMPLE or COMPLEX. SIMPLE tasks run on the Light model.
- After a COMPLEX verdict, the plugin records a durable `planning` snapshot before making a standalone Expert planner request. The planner has no tool schemas and is not an agent-loop step.
- A valid numbered plan becomes an `executing` snapshot with its first subtask `in_progress` before any subtask model request. Each subtask receives a level-2 Light assessment and runs sequentially on the selected tier.
- Each completion records a replacement snapshot before the next `agent.steer`. The plugin records `summarizing` before the Light-model summary and `completed` after it finishes.
- `h-model-routing/state` is the durable source for the `hModelRouting` session projection. The Web composition renders it in the H plan dock; the generic Todo projection is optional.

The plugin listens on `agent/pre-step`, `agent/request`, and `agent/turn-stopping` for root agents only. It uses `agent.steer` at turn boundaries and does not route subagent children.

## Settings

The plugin registers the `h-model-routing` settings namespace.

| Field | Meaning |
| --- | --- |
| `light` | `{ provider, model, reasoningEffort }`, one concrete Light model binding. |
| `expert` | `{ provider, model, reasoningEffort }`, one concrete Expert model binding. |
| `reasoningEffortMode` | `auto` does not force an effort; `manual` applies each tier's `reasoningEffort`. |

An empty `provider` or `model` disables that tier and leaves the default request route unchanged. Manual reasoning efforts are checked against the selected model; an unsupported effort is omitted.

## Failure And Interruption

- A failed level-1 assessment leaves the task on its default route. A failed level-2 assessment selects the Expert tier for that subtask.
- A failed or unparseable planner records `failed`, then the Expert model directly completes the original task. The plugin creates no synthetic subtask and does not add a summary step.
- A non-completed `turn/end` for a live plan folds its durable state to `interrupted`. This includes cancellation, errors, and cold session repair; interrupted work never resumes automatically.
- A fresh user task clears the previous H plan before its level-1 assessment. Completed, failed, and interrupted plans otherwise remain visible.

## Installation

Add the host plugin to a composition. The Web bundle includes this row and its client presentation plugin.

```yaml
- id: h-model-routing
  name: '@deepseek-ai/dsh-h-model-routing'
  config:
    emitTodoMirror: false
```

## Configuration

`emitTodoMirror` controls compatibility writes to `todo/write`. It defaults to `false`; Web keeps it disabled because `hModelRouting` is the single visible plan. A non-Web composition that still consumes the shared Todo projection can explicitly set it to `true`.

## Model Experience

### Routing Requests And Steered Steps

#### What the model sees

Level-1 and level-2 assessments are independent classifier requests. For complex work, the standalone planner receives `plannerPrompt(task)` on the Expert model with no tools and produces no assistant step. The plugin records `planning`, the accepted ordered plan, and each visible progress transition as `h-model-routing/state` snapshots. The first subtask instruction is injected at the admitting pre-step; later instructions and the final summary are injected through `agent.steer`. Each execution request receives only its current subtask instruction, and the summary receives the collected subtask results. Planner failure instead injects `directPrompt(task)` for one Expert completion.

##### Planner instruction

```markdown
Act as a planner. Break the following task into a numbered list of 2 to 8 subtasks.
Each subtask must be self-contained and independently executable in order.
Output ONLY the numbered list, one subtask per line, with no other text.
Do not call todo_write for this work; the subtask list is managed automatically.

Task:
<task>
```

##### Subtask instruction

```markdown
Subtask <index>/<count>:
<text>

Complete ONLY this subtask now and report the result concisely. Do not work on other subtasks — each remaining subtask is steered separately.
```

##### Direct fallback instruction

```markdown
Complete the following task directly and comprehensively now.

Task:
<task>
```

##### Summary instruction

```markdown
All subtasks of the original task are complete. Combine the subtask results below into ONE final answer
for the original task. Write ONLY the final answer — do not recap, enumerate, or repeat the subtasks or their completion status.

Original task:
<task>

Subtask results:
<subtask results>
```

#### Token effect

A SIMPLE task adds one independent classifier request. A COMPLEX task adds the level-1 classifier, one standalone planner request, one level-2 classifier per subtask, one execution step per subtask, and one summary step. Planner failure replaces the execution and summary chain with one direct Expert step.

#### KV Cache effect

Classifier and planner requests are independent from the ongoing conversation. Steered subtask and summary instructions extend the current turn, so their normal model requests retain the conversation prefix and do not open a new session.

## Known Limitations and Deferred Work

- **Sequential execution only** — the fixed plan has no parallel scheduler, reviewer, or dynamic re-planning.
- **No automatic resume** — an interrupted plan preserves its last known progress but requires a new user task to continue work.
- **Projection-dependent presentation** — the durable event is available wherever the plugin is composed; the H plan panel requires a client composition with the session-projection transport.
