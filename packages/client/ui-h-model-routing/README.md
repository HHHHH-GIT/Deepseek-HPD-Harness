# @deepseek-ai/dsh-client-ui-h-model-routing

English | [中文](README.zh.md)

Browser presentation plugin for the H model-routing plan. It contributes a `conversation.input.dock` entry that reads the host-computed `hModelRouting` projection through `useProjection`; no browser-side domain store, refresh path, or event listener exists. A complex task first shows the committed `planning` phase. When the host commits the ordered subtasks, the panel opens automatically and displays the active phase, task, completion count, and each subtask's pending, in-progress, or completed state. The panel remains visible through summarizing, completion, planner failure, and interruption.

Disclosure is local presentation state. A new `planId` is expanded by default, while a user collapse is retained for subsequent updates to that same plan. The plugin never mutates the H routing plan, starts work, or resumes an interrupted task.

## Model Experience

None, as the panel only renders the durable session projection that the host already emits and adds no model input or system-prompt content.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- **Read-only interruption state** — an interrupted plan remains visible for inspection, but this panel has no resume control; a future resume workflow must make its continuation authority explicit.
