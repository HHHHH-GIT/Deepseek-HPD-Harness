# Agent Note: Durable H routing plan progress

Status: implemented

English | [中文](2026-08-15-h-routing-durable-plan-progress.md)

## Problem

H 路由的 Planner 原本作为普通 Agent step 执行。它会收到原始任务和完整工具目录，因此可能在返回计划前先执行工作。唯一的可见任务状态是可选的 `todo/write` projection；Web 面板默认折叠，且未挂载 `dsh-tool-todo` 的 preset 没有该 projection。

## Decision

H 路由为每个可见计划记录一份完整的 `h-model-routing/state` 快照，并通过 `hModelRouting` session projection 对外提供。快照包含计划标识、所属 turn、任务、生命周期阶段和顺序子任务状态。客户端 H 计划插件在 composer dock 渲染该 projection；每个新计划自动展开一次，用户对同一计划的折叠选择会被保留。

一级评估返回 `COMPLEX` 后，H 会先记录 `planning`，再启动只使用 Expert 的独立 Planner 请求。该请求没有工具 schema，也不是 agent-loop step。计划解析成功后，首项处于 active 状态的完整列表会在第一个子任务模型请求前写入。每项完成时，先写新快照，再调用下一次 `agent.steer`；汇总和终态使用同一日志词汇。任何非 completed 的 turn end 都会把活动计划投影为 interrupted，其中包括冷加载的 turn 修复。H 不会自动续跑被中断的执行。

`todo/write` 是可选的兼容镜像。随 Web 发布的组合将其关闭，因为 H 计划面板是可见的事实来源，重复的任务列表会造成误导。

## Alternatives considered

**保留普通 Planner step，仅让 Todo 自动展开** —— 这会改善可见性，但不能阻止 Planner 执行原任务，也不能让缺少 Todo 的 preset 获得进度。

**让通用会话 Todo 面板识别 H 路由** —— 这会让通用 conversation 包依赖可选的 model-routing 功能。独立客户端插件能维持包方向，并让 H 的生命周期留在其所有者中。

**自动恢复中断计划** —— 重启后的进程无法证明中断前哪些工具已经完成。保留持久进度并等待新用户任务可以避免重复副作用。

## Consequences

- Web UI 通过现有 session-projection 传输收到规划和进度更新，不需要新 RPC 或客户端日志 fold。
- Planner 不能在计划提交前执行工具或生成普通 assistant 回复。
- H 状态可回放；辅助分类器和 Planner 的传输调用作为实现细节，由已提交的路由状态表示。
- 仍需要通用 Todo 输出的部署必须通过 `emitTodoMirror` 显式启用。
