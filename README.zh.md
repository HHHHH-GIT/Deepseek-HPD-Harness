# DeepSeek HPD Harness

[English](README.md) | 中文

DeepSeek HPD Harness是基于DeepSeek Harness (dsh) 二次开发的开源 agent harness（智能体框架），用于将 HPD 工作流架构落地到 agent 系统。

HPD 指 **Hierarchical · Parallel · Dynamic**：先对工作分层并选择执行路径，再并行调度相互独立的计划工作，并依据执行结果和质量信号动态调整后续决策。H 已提供，P 与 D 正在开发中。

该 harness 采用**一切皆插件**的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

## HPD 架构

DSH 正在向 HPD（**Hierarchical · Parallel · Dynamic**）演进。这是一套让计算资源真正用在提升结果之处的工作流架构。[阅读 HPD 理论文章](https://mp.weixin.qq.com/s/v2Sjuuc0aEk1Pmwxd124hA)。

| 维度 | 状态 | 含义 |
| --- | --- | --- |
| H — Hierarchical | 已提供 | 按复杂度分类每个任务：简单工作直接交给 Light 模型，复杂工作才进入 Expert 规划与执行路径。 |
| P — Parallel | 开发中 | 将依据任务 DAG 并行调度相互独立的计划工作，在不破坏依赖关系的前提下缩短总耗时。 |
| D — Dynamic | 开发中 | 将依据执行结果、质量检查和工具反馈审查、重新规划并选择下一步行动。 |

H 是首个已经交付的 HPD 维度。当前它会按顺序执行已接受的计划；P 与 D 正在积极开发中。

## H 升级带来的变化

H 把默认的单路径 agent 运行变为过程可见、按复杂度分流的工作流。简单工作保持直接处理，只有真正需要时才进入受控的规划路径。

| 未启用 H 路由 | 启用 H 路由 | 用户收益 |
| --- | --- | --- |
| 每个请求都使用一个已配置的 agent 路径。 | 一级评估将简单请求交给 Light，仅为复杂工作保留 Expert 规划。 | 小请求无需承担规划和 Expert 模型的额外开销。 |
| 规划可能发生在一个带工具的普通 agent 步骤中。 | Planner 是没有工具、也不生成 assistant 步骤的独立 Expert 请求；子任务执行前必须先生成计划。 | Planner 不能在展示待办工作前就完成原始任务。 |
| 进度依赖可选的通用 Todo 状态，可能较晚出现或完全不显示。 | 持久化计划快照会把 `planning`、顺序子任务、进行中的工作、汇总、完成、失败和中断发布到 H 计划面板。 | 复杂任务路由后立即出现计划，随后每个子任务按顺序推进。 |
| 失败和取消后只能从普通文本记录中判断状态。 | Planner 失败会先显示明确状态，再由 Expert 直接回答；中断计划保留已完成工作，且绝不自动恢复。 | 恢复过程更清晰，也不会悄然重复副作用。 |

## 运行

```sh
git clone https://github.com/HHHHH-GIT/Deepseek-HPD-Harness.git
cd Deepseek-HPD-Harness
pnpm install
pnpm run build
pnpm dsh web
```

## 开发

请先阅读[开发指南](docs/development.md)与[架构文档](docs/architecture.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
