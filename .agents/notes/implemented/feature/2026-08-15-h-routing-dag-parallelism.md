# Agent Note: H routing DAG parallelism

Status: implemented

English | [中文](2026-08-15-h-routing-dag-parallelism.zh.md)

## Problem

Sequential H subtask steering delayed useful work that had no dependency, and it represented a complex task as a list even when the work had a dependency graph. Reusing the root agent for every node also coupled tool state, cancellation, and audit history across otherwise independent work.

## Decision

`@deepseek-ai/dsh-h-model-routing` turns the root agent's first Expert step into a no-tools Planner and accepts only its final 2-8 node, topologically ordered DAG. Planner reasoning and its final response use the root conversation's normal assistant events; planning has no plugin deadline and remains cancellable through the root turn. The pre-step decision replaces that step's already prepared tool schemas without changing simple routed steps. Each node carries a display title of at most 48 characters, a complete instruction, and dependencies. A durable `h-model-routing/state` snapshot adds lifecycle state and the child session id after provider publication. The `hModelRouting` projection turns a live plan into `interrupted` when its enclosing turn does not complete.

P schedules every pending node whose dependencies completed, bounded by `maxConcurrentSubtasks` (default 3). Each node receives one level-2 classification that selects its Light or Expert tier and `spec`, `react`, or `weak` work style. Both choices enter the durable snapshot before the configured one-shot `subagentProvider` (default `spawn`) starts an independent child with the style's scoped persona and complete tool loop. A failure leaves independent nodes eligible and recursively blocks pending descendants. The root turn waits at its stopping boundary, then steers one Expert-model final summary step over all terminal results. Planner and summary use the same route so the summary extends a cache-compatible copy of the Planner request's complete root message prefix.

The browser dock renders this durable state. A turn-local presentation value derived from the planning snapshot marks the root Planner's first-step text as secondary output, so the final JSON remains a normal durable Assistant message and model-history prefix while the browser shows it behind a default-collapsed **Plan result** disclosure. The dock's list view is the default and labels each node's selected tier and work style; its graph view lays out the bounded DAG with SVG edges and numbered status circles whose hover and focus tooltip names both. Selecting a view and collapsing a plan are local state keyed by `planId`. A numbered node becomes pointer- and keyboard-navigable when its child session id is published and opens that one-shot subagent conversation.

## Lifecycle Ownership

The routing plugin owns an operation signal composed from the root turn signal and its plugin lifetime. It stops admission when either aborts, drains each published `SubagentRun`, and checks abort before publishing state. This keeps cancellation and HMR unload from emitting late snapshots or leaving subagents alive. The durable projection preserves the last committed state rather than trying to restart work after replay. A plan-clear event stores `null`; browser history replay treats null and other non-object payloads as coordinate-free events, so clearing an old plan cannot abort conversation assembly.

## Alternatives considered

- **Sequential root-agent steering** - keeps one session but cannot use independent ready work concurrently and lets one agent's context accumulate unrelated execution detail.
- **Shared root-agent parallel tool calls** - tools may overlap, but there is no isolated session, cancellation owner, or durable audit trail per DAG node.
- **Runtime file-conflict detection** - would require provider-specific workspace observation and cannot cover external side effects; P v1 instead requires Planner dependencies for shared mutable work.
- **A client-side scheduler** - would split durable progress ownership between host and browser and could not safely own subagent cancellation.
- **A standalone timed Planner call** - bounds planning duration, but hides reasoning, creates no root assistant step, and prevents the final summary from extending the Planner's conversation prefix.
- **A Light-model final summary** - reduces synthesis-model cost, but warms a second model with the complete root history and loses the Planner request's reusable Expert prefix.
- **A global behavior router** - would compete with Anchored Standard and can mutate Planner or root-session conditioning; node-scoped personas leave root planning and summary stable.

## Consequences

Complex work gains visible root planning, bounded parallel execution, dependency structure, selected-tier and work-style visibility, and direct child navigation while preserving the H router's Light/Expert node choice and no-auto-resume rule. Expert synthesis favors root-prefix cache reuse over Light-model summary cost. The Planner becomes responsible for accurately ordering shared writes and external effects. A long Planner remains active until completion or user cancellation. Behavior personas remain fixed for each isolated child, so siblings can use different styles without changing a live prefix. Subagent reasoning effort remains a future seam extension because the current start request accepts only provider and model options.
