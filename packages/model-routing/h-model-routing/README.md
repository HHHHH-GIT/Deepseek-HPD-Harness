# @deepseek-ai/dsh-h-model-routing

English | [中文](README.zh.md)

H routing classifies root-agent tasks into Light and Expert work. Complex work becomes a durable directed acyclic graph (DAG): P runs every ready node in an isolated subagent, up to the configured concurrency limit, then the root agent makes one Expert-model summary request that can reuse the Planner's model prefix. The agent-loop driver remains unchanged.

## Behavior

- Level 1 uses the Expert route to classify a user task. SIMPLE work enters one Light-model request.
- For COMPLEX work, H writes `planning`, then turns the root agent's first Expert step into the Planner. Its normal reasoning stream and final response appear in the main conversation. The final response must be strict JSON with 2-8 topologically ordered tasks; each task has an `id`, a display `title` of at most 48 characters, a self-contained `instruction`, and `dependsOn` task ids.
- P writes the complete `executing` snapshot before starting ready nodes. One level-2 Light request selects both the Light or Expert `route` and a `spec`, `react`, or `weak` work style. H records both before starting an isolated one-shot subagent with its assigned task and completed dependency results. The selected style supplies that child alone with a scoped persona.
- At most `maxConcurrentSubtasks` nodes classify and run at once. A node starts only after every dependency completes. A failed node does not stop independent work; its pending descendants become `blocked`.
- When every node is terminal, H records `summarizing`, injects the successful results, failures, and blocked work into one Expert-model summary request, then records `completed`. Keeping Planner and summary on the same route preserves the reusable root prefix instead of warming a second model with the complete conversation.
- `h-model-routing/state` is the durable source of the `hModelRouting` projection. Snapshots contain the immutable DAG, selected route and work style, and the `pending`, `in_progress`, `completed`, `failed`, or `blocked` node state. Web renders this projection and keeps the generic Todo mirror disabled by default.

Only root agents are routed. The Planner is part of that root flow, not a subagent. Isolated execution subagents have independent sessions, full tool loops, cancellation, and audit logs; their `origin: subagent` sessions do not recursively enter H routing.

## Settings

The plugin registers the `h-model-routing` settings namespace.

| Field | Meaning |
| --- | --- |
| `light` | `{ provider, model, reasoningEffort }`, one concrete Light model binding. |
| `expert` | `{ provider, model, reasoningEffort }`, one concrete Expert model binding. |
| `reasoningEffortMode` | `auto` leaves effort to the adapter; `manual` applies each tier's `reasoningEffort` to root-agent requests. |

An empty `provider` or `model` leaves that root request on its default route. Manual reasoning efforts are checked against the selected model and omitted when unsupported. The subagent seam currently accepts a provider and model, so a child uses its selected route without a separate reasoning-effort override.

## Configuration

```yaml
- id: h-model-routing
  name: '@deepseek-ai/dsh-h-model-routing'
  config:
    emitTodoMirror: false
    maxConcurrentSubtasks: 3
    subagentProvider: spawn
    behavior:
      enabled: true
      personas:
        spec: 'You are a careful software engineer. Inspect before changing.'
        react: 'You are a hands-on software engineer. Produce and verify.'
        weak: 'You are a software engineer completing one focused task.'
```

`emitTodoMirror` writes compatibility `todo/write` snapshots and defaults to `false`. `maxConcurrentSubtasks` is an integer from 1 through 8 and defaults to 3. `subagentProvider` names the registered one-shot provider and defaults to `spawn`; the Web bundle uses the isolated in-process spawn provider. `behavior.enabled` defaults to `true`; its three persona texts are deployment-owned and an empty text preserves the child's composed persona for that style. A selected behavior requires a provider with the `persona` capability.

## Failure And Interruption

- A failed level-1 assessment leaves the task on its default route. A failed level-2 assessment selects the Expert route for that node.
- An invalid or failed Planner response records `failed`, then one Expert request directly completes the original task. H creates neither a synthetic node nor a summary request. Planning has no plugin deadline; users can cancel the root turn through the normal agent control.
- Cancellation, root-agent failure, and plugin unload stop new DAG admission, cancel and drain published subagents, and publish no late progress snapshots. A non-completed `turn/end` projects any live plan as `interrupted`; cold replay preserves that state and never resumes it.
- A new user task clears the prior H plan before level-1 assessment. Completed, failed, and interrupted plans remain visible until then.

## Model Experience

### Routing And DAG Execution

#### What the model sees

The level-1 and level-2 classifiers are standalone routing requests. The Planner is a no-tools root-agent step: it sees the original task, streams reasoning through normal `assistant/chunk` events, and writes its final DAG JSON as an `assistant/message`. Each child sees the original task, exactly one DAG node, completed dependencies, and its selected work-style persona. After settlement, the same root conversation receives one final Expert summary directive, including partial-result limitations. Root instructions, Planner output, selected node routes and behaviors, and `h-model-routing/state` are durable; child work belongs to the isolated child sessions.

#### Token effect

A SIMPLE task adds one classifier request. A valid complex plan adds one planner request, one classifier and one child-agent turn per started node, plus one root summary request.

#### KV Cache effect

Classifier calls have no conversation prefix. Planner and summary use the same Expert route in one root turn, so the summary extends a cache-compatible copy of the Planner request's complete message prefix. Each child keeps one selected persona for its complete isolated run; sibling behavior choices therefore do not mutate a live root or child prefix. Child agents remain independent but begin with the same assembled system prefix, allowing provider prefix caching without mixing their task histories.

## Known Limitations and Deferred Work

- **Planner-declared ordering** - P trusts the DAG to serialize shared mutable files and external side effects; it does not detect runtime conflicts.
- **No automatic resume** - interrupted work keeps its last progress for inspection and never resumes without a new user task.
- **Provider effort gap** - the subagent start API does not yet expose a child reasoning-effort option.
- **Generic default personas** - deployments serving materially different model families should replace the configured `behavior.personas` after measuring those models on their own maintenance and build tasks.
