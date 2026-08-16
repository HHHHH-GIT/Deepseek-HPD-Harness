# Agent Note: Claude style theme

Status: implemented

English | [中文](2026-08-16-claude-style-theme.zh.md)

## Problem

The product theme registry originally exposed only the DeepSeek light and dark palettes plus the system preference. A warm Claude-inspired palette implemented only through background and label aliases left two gaps: the interface retained the default typography, and Shiki's light syntax colors became illegible when the theme selected a dark brown code surface.

## Decision

`ui-theme` ships `claude` as a durable built-in light theme. Semantic color overrides provide warm off-white surfaces, dark brown labels, restrained borders, and terracotta accents without adding theme branches to feature components.

The theme assigns Anthropic Sans to interface text, Anthropic Serif to assistant Markdown, and Anthropic Mono to code. The font faces use Anthropic's public production CDN with `font-display: swap`; every stack includes local Latin and CJK fallbacks so the application remains readable when the network fonts are unavailable or omit a glyph.

The dark brown code surface owns a complete Claude-specific Shiki variable set. Foreground, punctuation, comments, keywords, parameters, functions, strings, constants, and links each retain readable contrast against the code background. Other product themes continue using the shared light and dark Shiki palettes.

## Verification

Theme runtime tests assert that selecting `claude` publishes the three font roles and the dedicated Shiki foreground and punctuation colors. The focused Web build verifies that the font-face declarations enter the delivered stylesheet, while the served plugin bundle exposes the Claude theme token set.

## Alternatives considered

**Reuse the light Shiki palette.** This avoids another token set but makes punctuation and ordinary source text nearly disappear against the dark brown code surface. A code background and its syntax palette must be designed together.

**Use one sans-serif stack everywhere.** This avoids network fonts and minimizes typography differences, but it does not reproduce the interface, editorial prose, and code roles that define the Claude visual language.

**Bundle the font files in the repository.** This removes the runtime network dependency but redistributes branded font binaries without a repository-owned license grant. Referencing Anthropic's public CDN avoids committing those binaries and keeps explicit local fallbacks.

## Consequences

Claude mode has a distinct typography hierarchy and readable syntax highlighting without changing other themes. Its exact branded glyphs depend on Anthropic's CDN; offline clients immediately use the declared local fallbacks. Assistant Markdown uses a serif CJK fallback in Claude mode, so line wrapping can differ from the other themes.
