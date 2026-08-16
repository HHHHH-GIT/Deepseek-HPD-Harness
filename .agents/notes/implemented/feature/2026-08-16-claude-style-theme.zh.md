# Agent Note: Claude 风格主题

Status: implemented

[English](2026-08-16-claude-style-theme.md) | 中文

## Problem

产品主题注册表原本只提供 DeepSeek 浅色、深色和跟随系统三种偏好。仅通过背景与文字别名实现暖色 Claude 风格会留下两个缺口：界面仍沿用默认字体，而且主题选择深棕色代码背景后，Shiki 的浅色主题语法色会变得难以辨认。

## Decision

`ui-theme` 将 `claude` 作为可持久化的内置浅色主题交付。语义颜色覆盖提供暖白表面、深棕文字、克制边框和陶土色强调色，功能组件无需增加主题分支。

该主题把 Anthropic Sans 分配给界面文字，把 Anthropic Serif 分配给助手 Markdown，把 Anthropic Mono 分配给代码。字体文件通过 Anthropic 的公开生产 CDN 加载并使用 `font-display: swap`；每套字体栈都包含本机拉丁字符和中日韩字符回退，因此网络字体不可用或缺少某个字符时，应用仍然可读。

深棕色代码表面拥有完整的 Claude 专用 Shiki 变量集。普通文字、标点、注释、关键字、参数、函数、字符串、常量和链接在代码背景上都保持清晰对比度。其他产品主题继续使用共享的浅色与深色 Shiki 色板。

## Verification

主题运行时测试验证选择 `claude` 后会发布三种字体角色，以及专用的 Shiki 前景色和标点色。聚焦 Web 构建验证字体声明进入实际下发的样式表，同时服务提供的插件 bundle 包含 Claude 主题 token 集。

## Alternatives considered

**复用浅色 Shiki 色板。** 这种方案可以少维护一套 token，但会让标点和普通源码文字在深棕色背景上几乎消失。代码背景必须与语法色板配套设计。

**所有内容统一使用无衬线字体。** 这种方案不依赖网络字体且能减少排版差异，但无法呈现 Claude 视觉语言中的界面、编辑式正文和代码三种角色。

**把字体文件打包进仓库。** 这种方案能移除运行时网络依赖，却会在仓库没有字体授权文件的情况下重新分发品牌字体二进制文件。引用 Anthropic 的公开 CDN 可以避免提交这些文件，并保留明确的本机字体回退。

## Consequences

Claude 模式具有独立的字体层级和清晰的语法高亮，同时不改变其他主题。品牌字体的精确字形依赖 Anthropic CDN；离线客户端会立即使用声明的本机回退。Claude 模式的助手 Markdown 使用衬线类中文回退，因此换行位置可能与其他主题不同。
