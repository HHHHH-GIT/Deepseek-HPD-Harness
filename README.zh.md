# DeepSeek HPD Harness

[English](README.md) | 中文

DeepSeek HPD Harness 是基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 二次开发的开源 agent harness（智能体框架）。它把 HPD 理论落实到真实的 Agent 执行流程中：先判断任务应投入的能力，再把复杂工作表达为依赖图，并发执行相互独立的节点，同时让整个过程可见、可追溯。

HPD 指 **Hierarchical · Parallel · Dynamic**。项目目前已经实现 **H** 和 **P**，**D** 正在开发中。理论与设计动机详见 [HPD 理论文章](https://mp.weixin.qq.com/s/v2Sjuuc0aEk1Pmwxd124hA)。

## DSH 介绍

项目保留了 DSH **一切皆插件**的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动。Cordis 的设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

这个基础让模型、工具、会话、设置和 UI 贡献都可以替换。HPD 通过这些扩展点实现为插件，而不是修改一份分叉的 agent loop。

## 我们增加了什么？

| HPD 维度 | 状态 | 作用 |
| --- | --- | --- |
| **H - Hierarchical（分层）** | 已实现 | 一级评估将简单任务交给 Light，将复杂任务交给 Expert Planner。每个 DAG 节点启动前，二级评估同时选择 Light/Expert 层和执行策略。 |
| **P - Parallel（并行）** | 已实现 | Planner 生成经过校验的任务依赖 DAG。所有已就绪节点在隔离子 Agent 中执行，默认最多并发 3 个；有依赖的工作会等待前置节点。 |
| **D - Dynamic（动态）** | 开发中 | D 将根据中间结果质量和执行反馈审查计划，必要时重新规划并动态选择后续工作。当前调度器执行已经接受的 DAG，不进行质量驱动的重新规划。 |

对于复杂任务，Expert Planner 会在主对话中展示思考过程，并生成包含 2-8 个节点的 DAG。每个节点都有简短标题、可独立执行的完整指令和依赖关系。最终 JSON 会保留在历史记录中，但在界面上默认折叠为规划结果。

P 会在并发上限内启动所有依赖已满足的节点。二级评估会为每个节点选择模型层和一种策略：适合维护与调查的**审查优先**、适合集中实现的**执行优先**，或两者都不明显时的**自适应**。选择会持久化，并且只对该隔离子 Agent 生效。

一个分支失败时，独立分支继续工作；失败节点尚未启动的后继节点会变为阻塞。所有节点收敛后，根 Expert 会生成一份最终答复，保留可用结果并明确未完成限制。规划、执行、失败、中断、汇总和完成状态都会保留在计划快照中；中断任务可供查看，但不会自动恢复。

P v1 依赖 Planner 建立依赖来保障安全。修改共享文件、消费其他节点结果或产生关联外部副作用的任务必须在 DAG 中排序；运行时不尝试检测文件冲突。

## 我们同时适配了这些

HPD 将自身的调度模型与两个社区开源项目的核心思路结合，用于提高模型的有效上限，同时避免让主对话依赖不断变化的全局提示词。

| 项目 | 吸收的核心思路 | 如何融入 HPD |
| --- | --- | --- |
| [dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard) | 根会话首轮使用真实 Minimal 工具对，不注入自动工作区和技能上下文；首次持久化信号后开放完整 Standard 工具目录。 | 内置的**锚定标准模式**稳定首轮轨迹，减少初始提示词和工具噪声。H 让 Planner 与最终汇总保持兼容的 Expert 前缀，P 工作子 Agent 保留完整工具目录。 |
| [dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite) | 让任务匹配审查优先、执行优先或自适应等行为模式。 | H 的二级分类器在选择模型层时一并选择节点策略。对应 scoped persona 只注入该子 Agent，会在任务列表和任务图提示中显示，并随计划持久化。 |

本项目不会安装 routing-suite 的运行时注入器、全局工具过滤或逐消息引导。Anchored Standard 负责主会话前缀，HPD 负责任务分解、并行调度、持久化进度和节点局部行为。因此 Planner、汇总、缓存行为和子 Agent 执行都保持相互独立且易于理解。

Anchored Standard 的适配与署名文件位于 [`apps/cli/config/agent-presets/anchored-standard/`](apps/cli/config/agent-presets/anchored-standard/)。项目支持 Linux、macOS 和 Windows。Windows 使用锚定标准模式时，请安装 Git for Windows 以提供兼容的 Git Bash `bash` 工具，或者配置 preset 的 `bashPath`；其他 preset 仍可使用 PowerShell provider。

## 我们需要额外配置什么

对话输入区不再提供按消息选择模型的控件。请在创建会话前完成以下配置：

1. 打开**设置 > 模型**，配置模型提供方、API 凭据、端点和可用模型。凭据也可以来自进程环境变量或仓库根目录的 `.env` 文件。
2. 打开**设置 > 模型路由**，分别选择 **Light 模型**和 **Expert 模型**。Auto 思维链强度交给 adapter 决定；Manual 会把指定强度应用到每条根路由请求。个人实践且推荐的搭配是 DeepSeek V4 Flash（Light）+ DeepSeek V4 Pro（Expert）。
3. 打开**设置 > Agent presets**，将**锚定标准模式**设为后续新会话的默认 preset，或在新建会话界面的 preset chip 中选择它。会话创建时会固定 preset，因为历史记录依赖其工具目录。


复杂任务会在主对话和计划面板中展示状态。Planner 的思考过程在主对话流式显示，JSON 规划结果默认折叠。计划面板可切换列表和任务图：列表显示简短标题、状态、模型层和策略；任务图节点在悬停或键盘聚焦时显示同样的模型与策略。已经启动的节点可以直接打开对应子 Agent 对话。蓝色表示执行中，绿色表示完成，红色表示失败，灰色表示待执行或已阻塞。

## 从源码启动

### 环境要求

- Git
- Node.js `^22.19.0` 或 `>=24.0.0`
- pnpm `11.7.0`
- Windows 使用 Anchored Standard 时需要 Git Bash
- DeepSeek API Key，或者启动后在**设置 > 模型**中配置其他提供方

### 安装并启动

```sh
git clone https://github.com/HHHHH-GIT/Deepseek-HPD-Harness.git
cd Deepseek-HPD-Harness
pnpm install
```

使用内置 DeepSeek provider 时，在仓库根目录创建被 Git 忽略的 `.env` 文件：

```dotenv
DEEPSEEK_API_KEY=sk-your-key-here
# DEEPSEEK_BASE_URL=https://api.deepseek.com
```

构建 packages 和 Web 前端，然后启动应用：

```sh
pnpm run build
pnpm dsh web
```

浏览器打开 [http://127.0.0.1:3080](http://127.0.0.1:3080)。需要更换端口时运行：

```sh
pnpm dsh web --port 3081
```

首次启动后，依次配置**模型**、**模型路由**和 **Agent presets**，然后新建会话。开发 Web 前端时，保持 Web 进程运行，并在另一个终端启动重建 watcher：

```sh
pnpm run dev:web
```

## 还需要与大家一起改进的地方

H 和 P 已经提供了可用的第一版，但还不是模型调度的最终答案。P 目前会为每个获准执行的 DAG 节点创建一个隔离的一次性子 Agent，并受固定并发上限约束。这有利于独立执行和审计，但并不一定是延迟、Token 成本、缓存复用或 provider 配额下的最优选择。

### 缓存命中率问题

任务分叉后，只看根会话的缓存命中率已经不完整。每个子 Agent 都有独立的请求历史：首个请求无法复用根对话前缀，任务指令和已完成依赖也会改变后续前缀。因此，较低的根会话命中率可能掩盖已经缓存的子 Agent 输入；而较低的聚合命中率才可能代表不必要扇出造成的真实成本。

我们需要把一个任务的根会话与全部子会话放在一起计量：输入 Token、缓存输入 Token、输出 Token、延迟、重试、所选模型和策略，以及最终结果。更有意义的指标是这个任务内所有请求的 `总缓存输入 / 总输入`，并在相同模型和工作负载下对比。这样才能区分遥测统计遗漏与真正的缓存回归。

可行的优化方向包括稳定且面向缓存的前缀、规模较小的固定 persona 集合、紧凑的依赖交接，以及避免为本应连续执行的工作反复创建新 Agent。Planner 与最终汇总已经共享兼容的 Expert 根前缀；下一步是让一条工作者链也能保留可复用前缀，同时不混入无关兄弟节点的上下文。

### 更好的Agent分配策略

一个工作者总能按拓扑序串行执行一个 DAG，因此它是满足正确性的最少工作者数，但会失去并行加速。每个节点各用一个工作者能暴露全部可用并行度，却会创建大量新上下文，成本可能高于它节省的时间。因此，调度决策并不只是节点数量。

DAG 最小路径覆盖可以作为把依赖工作合并为工作者链的基线。明确一条链是否可以使用传递依赖后，可以使用拆点二分图和最大匹配求解；标准形式下最小覆盖数为 `n - 最大匹配数`。它最小化的是链数，不是总耗时或 Token 成本。固定工作者数且存在依赖约束时，最小化总工期通常是 NP-hard 问题，因此 HPD 应以可测量的启发式和小规模精确求解作为参照，而不是宣称存在一种通用最优解。

欢迎贡献代表性的 DAG 工作负载、端到端缓存与延迟遥测、成本估计器、工作者链和可延续子 Agent 支持，以及基准调度器。小图可以用精确最大匹配、CP-SAT 或整数规划建立基线；较大的在线任务更适合关键路径列表调度和聚类方法。

## 开发

修改项目前请先阅读[开发指南](docs/development.md)和[架构文档](docs/architecture.md)。编码 Agent 还必须遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)。第三方依赖和适配组件的声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 及其随附 notice 文件。
