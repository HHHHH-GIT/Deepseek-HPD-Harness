# @deepseek-ai/dsh-h-model-routing

[English](README.md) | 中文

DSH 的分层模型路由。该插件对每个根 agent（智能体）任务进行分类，并在不修改 agent loop（智能体循环）驱动器的前提下选择已配置的 Light 或 Expert 模型。

## 行为

- 一级 Expert 评估将新用户任务分类为 SIMPLE 或 COMPLEX。SIMPLE 任务由 Light 模型执行。
- 得到 COMPLEX 结论后，插件会先记录持久化的 `planning` 快照，再发起独立的 Expert Planner 请求。Planner 没有工具 schema，也不是 agent-loop step。
- 有效的编号计划会成为 `executing` 快照；在任何子任务模型请求前，第一项已经标记为 `in_progress`。每个子任务都接受二级 Light 评估，并按选定层级顺序执行。
- 每项完成时，插件先记录替换快照，再调用下一次 `agent.steer`。Light 模型汇总前记录 `summarizing`，汇总完成后记录 `completed`。
- `h-model-routing/state` 是 `hModelRouting` session projection 的持久化真源。Web 组合在 H 计划 dock 中渲染它；通用 Todo projection 为可选项。

该插件只为根 agent 监听 `agent/pre-step`、`agent/request` 和 `agent/turn-stopping`。它在轮次边界使用 `agent.steer`，且不会路由 subagent 子级。

## 设置

插件注册 `h-model-routing` 设置命名空间。

| 字段 | 含义 |
| --- | --- |
| `light` | `{ provider, model, reasoningEffort }`，一个具体的 Light 模型绑定。 |
| `expert` | `{ provider, model, reasoningEffort }`，一个具体的 Expert 模型绑定。 |
| `reasoningEffortMode` | `auto` 不强制 effort；`manual` 应用每层的 `reasoningEffort`。 |

空的 `provider` 或 `model` 会关闭该层路由，并保留默认请求路由。手动推理强度会针对所选模型校验；不支持的 effort 会被忽略。

## 失败与中断

- 一级评估失败时，任务保留在默认路由。二级评估失败时，该子任务选择 Expert 层。
- Planner 请求失败或输出不可解析时，插件记录 `failed`，然后由 Expert 模型直接完成原任务。插件不会创建伪造的子任务，也不会增加汇总步骤。
- 对活动计划而言，非 completed 的 `turn/end` 会把持久状态折叠为 `interrupted`。这包括取消、错误和冷会话修复；中断工作绝不会自动恢复。
- 新用户任务会在一级评估前清除先前的 H 计划。否则，已完成、失败和中断的计划都会继续显示。

## 安装

在组合中加入 host 插件。Web bundle 已包含该项及其客户端展示插件。

```yaml
- id: h-model-routing
  name: '@deepseek-ai/dsh-h-model-routing'
  config:
    emitTodoMirror: false
```

## 配置

`emitTodoMirror` 控制写入兼容用的 `todo/write`。默认值为 `false`；Web 保持关闭，因为 `hModelRouting` 是唯一的可见计划。仍需消费共享 Todo projection 的非 Web 组合可显式设为 `true`。

## 模型体验

### 路由请求与中途引导步骤

#### 模型可见内容

一级和二级评估是独立的分类器请求。对于复杂工作，独立 Planner 在 Expert 模型上接收不带工具的 `plannerPrompt(task)`，且不会生成 assistant step。插件把 `planning`、已接受的顺序计划和每个可见进度变更记录为 `h-model-routing/state` 快照。第一项子任务指令在准入 pre-step 直接注入；之后的指令和最终汇总通过 `agent.steer` 注入。每个执行请求只接收当前子任务指令，汇总请求接收收集到的子任务结果。Planner 失败时则注入 `directPrompt(task)`，由 Expert 完成一次直接回答。

##### Planner 指令

```markdown
Act as a planner. Break the following task into a numbered list of 2 to 8 subtasks.
Each subtask must be self-contained and independently executable in order.
Output ONLY the numbered list, one subtask per line, with no other text.
Do not call todo_write for this work; the subtask list is managed automatically.

Task:
<task>
```

##### 子任务指令

```markdown
Subtask <index>/<count>:
<text>

Complete ONLY this subtask now and report the result concisely. Do not work on other subtasks — each remaining subtask is steered separately.
```

##### 直接回退指令

```markdown
Complete the following task directly and comprehensively now.

Task:
<task>
```

##### 汇总指令

```markdown
All subtasks of the original task are complete. Combine the subtask results below into ONE final answer
for the original task. Write ONLY the final answer — do not recap, enumerate, or repeat the subtasks or their completion status.

Original task:
<task>

Subtask results:
<subtask results>
```

#### Token 用量

SIMPLE 任务增加一个独立的分类器请求。COMPLEX 任务增加一级分类器、一个独立 Planner 请求、每项子任务一个二级分类器、每项子任务一个执行步骤和一个汇总步骤。Planner 失败时，执行与汇总链会被一个直接 Expert 步骤替代。

#### KV Cache 影响

分类器和 Planner 请求独立于进行中的对话。中途引导的子任务和汇总指令扩展当前轮次，因此其普通模型请求保留对话前缀，且不会打开新会话。

## 已知局限与延后工作

- **仅支持顺序执行** —— 固定计划没有并行调度器、Reviewer 或动态重新规划。
- **不自动恢复** —— 中断计划保留最后已知进度，但继续工作需要一条新用户任务。
- **展示依赖 projection** —— 只要组合了该插件，持久化事件即可使用；H 计划面板还需要带 session-projection 传输的客户端组合。
