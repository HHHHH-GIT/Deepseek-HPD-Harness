# Agent Note: H 路由 DAG 并行执行

Status: implemented

[English](2026-08-15-h-routing-dag-parallelism.md) | 中文

## 问题

顺序引导 H 子任务会推迟没有依赖关系的有效工作，并且即使工作本身有依赖图，也只能把复杂任务表示为列表。让根 agent 执行每个节点还会把本应独立工作的工具状态、取消和审计历史耦合在一起。

## 决策

`@deepseek-ai/dsh-h-model-routing` 把根 agent 的首个 Expert 步骤转为无工具 Planner，并且只接受其最终输出的 2-8 节点、拓扑排序 DAG。Planner 推理和最终响应使用根对话的普通 assistant 事件；规划没有插件截止时间，仍可通过根轮次取消。pre-step 决策会替换该步骤已准备的工具 schema，而不改变简单任务的路由步骤。每个节点带有最长 48 个字符的展示标题、完整指令和依赖。持久化 `h-model-routing/state` 快照还包含生命周期状态，以及 provider 发布后的子会话 id。只要包含计划的轮次没有完成，`hModelRouting` projection 就会把活动计划变为 `interrupted`。

P 调度所有依赖已完成的 pending 节点，数量受 `maxConcurrentSubtasks` 限制，默认值为 3。每个节点接受一次二级分类，同时选择 Light 或 Expert 层和 `spec`、`react` 或 `weak` 工作策略。两项选择会在配置的一次性 `subagentProvider` 启动独立子会话前写入持久化快照，默认 provider 是 `spawn`；子会话使用该策略的 scoped persona 和完整工具循环。一个节点失败后，独立节点仍然可以运行，尚未启动的后继节点会递归标记为 blocked。根轮次在停止边界等待，再对所有终态结果引导一次 Expert 模型最终汇总步骤。Planner 与汇总使用相同路由，因此汇总会延续与 Planner 请求缓存兼容的完整根消息前缀。

浏览器 dock 渲染这个持久状态。由 planning 快照派生的 turn 本地展示值会把根 Planner 首步正文标记为次要输出，因此最终 JSON 仍是普通的持久化 Assistant 消息和模型历史前缀，但浏览器会把它放在默认收起的“规划结果”中。列表模式默认显示，并标记每个节点选定的模型层和工作策略；任务图模式使用 SVG 边和带状态的编号圆形节点布局受限 DAG，悬停或聚焦气泡会显示两者。选择视图和折叠计划是以 `planId` 为键的本地状态。子会话 id 发布后，编号节点可以通过指针和键盘操作，并打开对应的一次性 subagent 对话。

## 生命周期所有权

路由插件拥有一个由根轮次信号和插件生命周期组成的操作信号。任一信号取消都会停止新节点准入，等待每个已发布 `SubagentRun` 收敛，并在写入状态前检查取消。这样取消和 HMR 卸载不会产生晚到的快照或遗留 subagent。持久化 projection 保留最后一次已提交状态，而不是在回放后尝试重启工作。计划清除事件存储 `null`；浏览器历史回放把 null 和其他非对象 payload 视为无坐标事件，因此清除旧计划不会中断对话组装。

## 曾考虑的替代方案

- **顺序根 agent 引导** - 可以保持单一会话，但无法并发使用独立的已就绪工作，也会让一个 agent 的上下文积累无关执行细节。
- **共享根 agent 的并行工具调用** - 工具可以重叠，但每个 DAG 节点没有隔离会话、取消所有者或持久化审计记录。
- **运行时文件冲突检测** - 需要依赖 provider 的工作区观察，且无法涵盖外部副作用；P v1 改为要求 Planner 为共享可变工作声明依赖。
- **客户端调度器** - 会让 host 和浏览器分割持久进度所有权，也不能安全拥有 subagent 取消。
- **带时限的独立 Planner 调用** - 可以限制规划时长，但会隐藏推理过程，不生成根 assistant 步骤，也使最终汇总无法延续 Planner 的对话前缀。
- **使用 Light 模型最终汇总** - 可以降低汇总模型成本，但会用完整根历史预热第二个模型，并失去 Planner 请求可复用的 Expert 前缀。
- **全局行为路由器** - 会与 Anchored Standard 竞争，并可能改变 Planner 或根会话的条件；节点 scoped persona 会保持根规划和汇总稳定。

## 后果

复杂工作获得可见的根流程规划、有上限的并行执行、依赖结构、模型层和工作策略可见性以及直接子会话导航，同时保留 H 路由对节点的 Light/Expert 选择和不自动恢复规则。Expert 汇总优先复用根前缀缓存，而不是降低 Light 汇总模型成本。Planner 必须准确排序共享写入和外部副作用。长时间 Planner 会保持活动，直到完成或用户取消。每个隔离子会话的行为 persona 固定，因此兄弟节点可以使用不同策略而不改变运行中的前缀。subagent reasoning effort 仍是未来的 seam 扩展，因为当前 start 请求只接受 provider 和 model 选项。
