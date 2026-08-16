# Agent Note: Anchored Standard preset

Status: implemented

English | [中文](2026-08-15-anchored-standard-preset.zh.md)

## Problem

DeepSeek V4 can select a materially different first-response trajectory when the first request exposes the Standard preset's large tool catalog and automatic workspace or skill context. The Minimal preset supplies a favorable two-tool first-request surface but cannot perform the broader work expected from Standard after that trajectory is established.

## Decision

The CLI ships `anchored-standard` as a selectable system agent preset. Its root session uses the Minimal persona and exposes only `bash` plus `str_replace_editor` before the first durable `tool/call` or `assistant/message`. It also omits automatic workspace-instruction and skill-catalog messages from that first request.

After promotion, the root catalog keeps the two bootstrap tools plus `dev_tool_search`, `skill_search`, and `skill_load`. A successful `dev_tool_search` call records requested tool names in durable `tool/call` arguments, and subsequent assemblies expose those tools. A compaction starts a new promotion epoch with a configured core recovery set.

Delegated agents, including H/P DAG workers, retain the complete inherited preset catalog. Root-session trajectory control therefore does not restrict isolated execution. Windows uses a `bash` tool backed by Git Bash discovered beside the active `git` executable; `bashPath` remains an explicit override.

The bundled files preserve the source project's MIT license and notice. Only the main Anchored Standard variant ships; the fixed zero-tool and whoami warm-up variants remain external experiments because each inserts an extra model turn before the user's task.

## Verification

The real Web composition test asserts that discovery lists the preset, a fresh root assembly contains exactly the two bootstrap tools, a delegated assembly contains the full catalog, and the Windows `bash` tool executes through the discovered Git Bash installation.

## Alternatives considered

**Keep the preset user-installed.** This preserves upstream separation but makes each deployment copy and maintain a full preset snapshot manually. A shipped system preset gives the settings UI one discoverable, versioned composition.

**Promote directly to the complete Standard catalog.** This restores every tool without discovery, but it also recreates the large catalog that the preset is designed to avoid and changes the request prefix once. The resident discovery set keeps the post-promotion prefix smaller.

**Apply the restricted catalog to subagents.** This maximizes consistency between parent and child requests but prevents H/P workers from reliably using the capabilities their assigned nodes require. Delegated agents instead inherit the full catalog.

## Consequences

The first root request has the Minimal tool schema and a smaller prefix. Promotion changes the prefix once, and each later tool unlock changes it again, so on-demand breadth trades some KV-cache continuity for a smaller normal catalog. On Windows, the custom Bash executor has no Landlock confinement and requires Git Bash; resolution failure names the `bashPath` override. The preset intentionally replaces full automatic instruction injection with a short post-promotion hint, so the model must read relevant instruction files before acting.
