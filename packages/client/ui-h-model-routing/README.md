# @deepseek-ai/dsh-client-ui-h-model-routing

English | [中文](README.zh.md)

Browser presentation for the durable H routing plan. The plugin contributes one `conversation.input.dock` entry and reads the host-computed `hModelRouting` projection through `useProjection`; it owns no browser-side scheduler, domain store, refresh path, or event listener.

A complex task first shows `planning` while the root Planner's reasoning streams in the main conversation. The Planner's final JSON remains in the durable Assistant message and model history, while the browser renders that text as a default-collapsed **Plan result** disclosure. Once a DAG is committed, the panel opens and shows its phase, aggregate completion count, and either a list or task graph. List mode is the default and displays concise task titles, execution state, and the selected `Light` or `Expert` tier; nodes not yet routed or blocked before execution have explicit labels. Task-graph mode uses an automatic DAG layout with SVG edges and numbered circles only: running is blue, completed green, failed red, and pending or blocked grey. Hovering or focusing a numbered node shows its model tier, and its accessible name contains the task number, state, tier, and dependencies.

The selected view and disclosure state are local presentation state. A new `planId` resets to the list and starts expanded. A user collapse or graph selection persists through updates for that same plan. A graph node becomes keyboard- and pointer-navigable after its child `sessionId` is published; activating it opens that one-shot subagent conversation. Pending nodes without a session remain inert. The panel keeps completed, failed, and interrupted plans visible until the next task clears the projection. It never changes a plan, starts a node, or resumes interrupted work.

## Model Experience

None, as the plugin only renders durable projection data and adds no model-visible content or system prompt.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- **Read-only interruption state** - an interrupted plan remains inspectable, but this panel exposes no resume control.
- **Bounded graph canvas** - H plans have at most eight nodes; narrow displays scroll the graph horizontally rather than shrinking or overlapping nodes.
