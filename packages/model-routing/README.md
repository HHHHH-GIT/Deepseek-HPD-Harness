# model-routing/ - hierarchical model routing

English | [中文](README.zh.md)

Routing policies select configured model tiers at agent-loop extension points. They do not own an LLM provider or the agent loop; durable routing state belongs to the session log when users need replayable progress.

| Package | Role | ctx key |
| --- | --- | --- |
| [`h-model-routing/`](h-model-routing/README.md) | Complexity-gated Light/Expert routing with durable plan progress | - |
