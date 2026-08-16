# Agent Note: 锚定标准 preset

Status: implemented

[English](2026-08-15-anchored-standard-preset.md) | 中文

## Problem

当首次请求暴露标准模式的大型工具目录以及自动注入的工作区或技能上下文时，DeepSeek V4 可能选择明显不同的首轮响应轨迹。极简模式能提供更有利的双工具首请求界面，但在轨迹建立之后无法完成标准模式所覆盖的广泛工作。

## Decision

CLI 将 `anchored-standard` 作为可选择的系统 agent preset 交付。根会话使用极简模式 persona，并在首次持久化 `tool/call` 或 `assistant/message` 之前只暴露 `bash` 与 `str_replace_editor`。首次请求也不包含自动注入的工作区指令和技能目录消息。

提升后，根会话工具目录保留两个引导工具以及 `dev_tool_search`、`skill_search` 和 `skill_load`。成功的 `dev_tool_search` 调用把请求的工具名称记录在持久化 `tool/call` 参数中，后续组装会暴露这些工具。压缩会以配置的核心恢复工具集开启新的提升周期。

委派 agent（包括 H/P DAG 工作 agent）保留继承 preset 的完整工具目录。因此，根会话的轨迹控制不会限制隔离执行。Windows 使用由 Git Bash 支持的 `bash` 工具，并在当前 `git` 可执行文件旁自动发现 Git Bash；`bashPath` 仍可用于显式覆盖。

内置文件保留来源项目的 MIT 许可证和声明。产品只交付主 Anchored Standard 变体；固定零工具与 whoami 预热变体仍作为外部实验保留，因为二者都会在用户任务之前增加一次模型调用。

## Verification

真实 Web 组合测试验证：发现结果包含该 preset；新根会话的组装只包含两个引导工具；委派组装包含完整工具目录；Windows `bash` 工具能通过自动发现的 Git Bash 安装执行命令。

## Alternatives considered

**继续由用户安装 preset。** 这种方式保持与上游分离，但要求每个部署手工复制并维护完整 preset 快照。作为系统 preset 交付后，设置界面能直接发现一份有版本约束的组合。

**提升后直接开放完整标准工具目录。** 这种方式无需发现即可恢复全部工具，但也会重新引入本 preset 试图避免的大型目录，并改变一次请求前缀。常驻发现工具集让提升后的常规目录保持更小。

**对子 agent 同样限制工具目录。** 这种方式让父子请求更一致，却会导致 H/P 工作 agent 无法可靠使用其任务节点所需能力。因此，委派 agent 继承完整工具目录。

## Consequences

根会话首个请求具有极简工具 schema 和更小的前缀。提升会改变一次前缀，之后每次解锁工具也会再次改变前缀，因此按需扩展能力以部分 KV 缓存连续性换取更小的常规工具目录。Windows 自定义 Bash 执行器不受 Landlock 约束并依赖 Git Bash；解析失败会提示使用 `bashPath` 覆盖。该 preset 有意用简短的提升后提示替代完整自动指令注入，因此模型必须在行动前读取相关指令文件。
