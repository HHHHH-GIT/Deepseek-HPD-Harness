# @deepseek-ai/dsh-h-model-routing

[English](README.md) | 中文

H 路由会把根 agent 任务分为 Light 与 Expert 工作。复杂工作会成为持久化的有向无环图（DAG）：P 使用隔离 subagent 执行所有已就绪节点，数量不超过配置的并发上限，随后根 agent 发起一次能够复用 Planner 模型前缀的 Expert 模型汇总请求。agent-loop 驱动器保持不变。

## 行为

- 一级使用 Expert 路由评估用户任务。SIMPLE 工作进入一次 Light 模型请求。
- 对 COMPLEX 工作，H 会先写入 `planning`，再把根 agent 的首个 Expert 步骤转为 Planner。正常推理流和最终响应都会显示在主对话中。最终响应必须是严格 JSON，包含 2-8 个拓扑排序的任务；每项带有 `id`、最长 48 个字符的展示 `title`、可独立执行的 `instruction` 和依赖任务编号 `dependsOn`。
- P 会在启动已就绪节点前写入完整的 `executing` 快照。一次二级 Light 请求会同时选择 Light 或 Expert `route`，以及 `spec`、`react` 或 `weak` 工作策略。H 会在启动隔离的一次性 subagent 前记录两者；子 Agent 会收到被分配的任务、已完成依赖的结果，以及只在该子会话生效的策略 persona。
- 同时处于评估和执行生命周期的节点不超过 `maxConcurrentSubtasks`。节点只能在全部依赖完成后启动。节点失败不会停止独立工作；尚未启动的后继节点会标记为 `blocked`。
- 所有节点进入终态后，H 写入 `summarizing`，将成功结果、失败和阻塞工作注入一次 Expert 模型汇总请求，随后写入 `completed`。Planner 与汇总使用相同路由，可以保留可复用的根会话前缀，避免再用完整对话预热第二个模型。
- `h-model-routing/state` 是 `hModelRouting` projection 的持久化真源。快照包含不可变 DAG、选定的路由和工作策略，以及节点的 `pending`、`in_progress`、`completed`、`failed` 或 `blocked` 状态。Web 渲染该 projection，且默认不启用通用 Todo 镜像。

只有根 agent 会进入 H 路由。Planner 属于根流程，不是 subagent。隔离的执行 subagent 拥有独立会话、完整工具循环、取消和审计日志；带有 `origin: subagent` 的会话不会递归进入 H 路由。

## 设置

插件注册 `h-model-routing` 设置命名空间。

| 字段 | 含义 |
| --- | --- |
| `light` | `{ provider, model, reasoningEffort }`，一个具体的 Light 模型绑定。 |
| `expert` | `{ provider, model, reasoningEffort }`，一个具体的 Expert 模型绑定。 |
| `reasoningEffortMode` | `auto` 将 effort 交给 adapter；`manual` 对根 agent 请求应用每层的 `reasoningEffort`。 |

空的 `provider` 或 `model` 会让相应根请求保留默认路由。手动推理强度会针对所选模型校验，不支持时会省略。subagent seam 目前只接受 provider 和 model，因此子 Agent 使用选定路由，但没有单独的 reasoning-effort 覆盖项。

## 配置

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

`emitTodoMirror` 写入兼容用的 `todo/write` 快照，默认 `false`。`maxConcurrentSubtasks` 是 1 到 8 的整数，默认 3。`subagentProvider` 指定已注册的一次性 provider，默认 `spawn`；Web bundle 使用隔离的进程内 spawn provider。`behavior.enabled` 默认 `true`；三项 persona 文本由部署配置拥有，某项为空时会保留该策略的子 Agent 组合 persona。选定策略要求 provider 支持 `persona` 能力。

## 失败与中断

- 一级评估失败时，任务保留默认路由。二级评估失败时，该节点选择 Expert 路由。
- Planner 请求失败或输出无效时，会记录 `failed`，然后由一次 Expert 请求直接完成原任务。H 不会创建伪造节点，也不会发起汇总请求。规划没有插件截止时间；用户可以通过普通 agent 控件取消根轮次。
- 取消、根 agent 失败和插件卸载会停止新节点准入，取消并等待已发布 subagent 收敛，且不写入晚到的进度快照。非 completed 的 `turn/end` 会把活动计划投影为 `interrupted`；冷重放会保留该状态，绝不自动恢复。
- 新用户任务会在一级评估前清除原 H 计划。否则，已完成、失败和中断的计划都会持续显示。

## 模型体验

### 路由与 DAG 执行

#### 模型可见内容

一级、二级分类器是独立的路由请求。Planner 是根 agent 的无工具步骤：它看到原任务，通过普通 `assistant/chunk` 事件流式写入推理，并把最终 DAG JSON 记录为 `assistant/message`。每个子 Agent 看到原任务、恰好一个 DAG 节点、已完成依赖和选定工作策略的 persona。调度器收敛后，同一根对话会收到一次最终 Expert 汇总指令，其中包含部分结果的限制。根指令、Planner 输出、节点所选路由和工作策略，以及 `h-model-routing/state` 都是持久事件，子 Agent 工作则属于隔离的子会话。

#### Token 影响

SIMPLE 任务增加一次分类器请求。有效复杂计划增加一次 Planner 请求、每个已启动节点的一次分类器和一次子 Agent 轮次，以及一次根汇总请求。

#### KV Cache 影响

分类器请求没有对话前缀。Planner 与汇总在同一个根轮次中使用相同的 Expert 路由，因此汇总会延续与 Planner 请求缓存兼容的完整消息前缀。每个子 Agent 在整个隔离运行期间保持一个选定 persona，因此兄弟节点的策略选择不会改变运行中的根或子会话前缀。子 Agent 仍保持独立，但都从相同的已组装系统前缀开始，使 provider 能在不混合任务历史的情况下复用前缀缓存。

## 已知局限与延后工作

- **依赖由 Planner 声明** - P 信任 DAG 对共享可变文件和外部副作用进行排序，不检测运行时冲突。
- **不自动恢复** - 中断工作保留最后进度以供检查，且不会在没有新用户任务时恢复。
- **Provider effort 缺口** - subagent start API 还没有暴露子 Agent 的 reasoning-effort 选项。
- **通用默认 persona** - 面向不同模型族的部署应当先在自身的维护与构建任务上测量，再替换配置中的 `behavior.personas`。
