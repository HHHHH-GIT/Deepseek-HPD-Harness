# @deepseek-ai/dsh-client-ui-settings-model-routing

[English](README.md) | 中文

第一版分层路由的"模型路由"设置页：从现有 `llm.models` 目录中各选择一个具体的
**Light Model** 与 **Expert Model**，并配置 Auto/Manual 思维链强度模式；
所有写入都走现有 `settings.describe` / `settings.mutate` 通道，落在 `h-model-routing` 设置命名空间。

## Slots

注册一个 `settings.section` 条目（id `model-routing`，order 20）。

## Model Experience

None, as the section renders a browser configuration UI; the host h-model-routing plugin it configures owns every model-visible effect.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **仅目录内模型**——下拉只列出适配器声明的模型；适配器未描述的手工配置路由无法在此选择。
- **不做可达性校验**——页面只经过 wire 通道校验；不可用的绑定在请求时降级。
