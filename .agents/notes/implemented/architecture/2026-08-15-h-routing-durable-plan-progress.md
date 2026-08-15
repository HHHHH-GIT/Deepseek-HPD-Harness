# Agent Note: Durable H routing plan progress

Status: implemented

English | [中文](2026-08-15-h-routing-durable-plan-progress.zh.md)

## Problem

The H routing planner ran as an ordinary agent step. It received the original task and the normal tool catalog, so it could perform work before returning a plan. The only visible task state was the optional `todo/write` projection, whose Web panel starts collapsed and is absent from presets that do not mount `dsh-tool-todo`.

## Decision

H routing records one full `h-model-routing/state` snapshot for each visible plan and exposes it through the `hModelRouting` session projection. The snapshot carries the plan identity, owning turn, task, lifecycle phase, and sequential subtask statuses. The client H plan plugin renders that projection in the composer dock and opens each new plan once; a user collapse remains in force for that plan.

After level-1 returns `COMPLEX`, H records `planning` before starting an Expert-only standalone planner request. That request has no tool schemas and does not become an agent-loop step. A parsed plan records its first item as active before the first subtask model request. Each completed item writes a new snapshot before the next `agent.steer`; summary and terminal states use the same log vocabulary. A non-completed turn end projects an active plan as interrupted, including cold-load turn repair. H does not resume interrupted execution automatically.

`todo/write` is an optional compatibility mirror. The shipped Web composition disables it because the H plan panel is the visible source of truth and two copies of the list are misleading.

## Alternatives considered

**Keep the ordinary planner step and only auto-expand Todo** — this improves visibility but does not stop the planner from executing the user task or make progress available to presets without Todo.

**Make the generic conversation Todo panel understand H routing** — this would couple the generic conversation package to an optional model-routing feature. A separate client plugin preserves the package direction and keeps the H-specific lifecycle in its owner.

**Automatically resume an interrupted plan** — a restarted process cannot prove which tools completed before interruption. Showing the durable progress while requiring a new user task avoids duplicated side effects.

## Consequences

- The Web UI receives planning and progress updates through the existing session-projection transport; no new RPC or client-side log fold is needed.
- The planner cannot perform tools or produce a normal assistant response before the plan is committed.
- The H state is replayable, while the auxiliary classifier and planner transport calls remain implementation details represented by their committed routing state.
- A deployment that still needs generic Todo output must opt in through `emitTodoMirror`.
