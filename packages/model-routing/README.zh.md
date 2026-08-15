# model-routing/ - 分层模型路由

[English](README.md) | 中文

路由策略会在 agent loop（智能体循环）扩展点选择已配置的模型层级。它们不拥有 LLM（大语言模型）提供方或 agent loop；当用户需要可回放的进度时，持久化路由状态属于会话日志。

| 包 | 职责 | ctx 键 |
| --- | --- | --- |
| [`h-model-routing/`](h-model-routing/README.md) | 按复杂度选择 Light/Expert 的路由，并提供持久化计划进度 | - |
