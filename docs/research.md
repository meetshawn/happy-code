# Research Summary (as of 2026-02-11)

This project investigated `Claude Code`, `Codex CLI`, and `OpenCode` to derive an implementation strategy.

## 1) Claude Code

- npm package: `@anthropic-ai/claude-code@2.1.39`
- CLI entry: `bin.claude = cli.js`
- Node requirement: `>=18`
- Status: official README marks npm installation as deprecated in favor of script/system package distribution.
- Observation: published package uses a bundled single-entry `cli.js` runtime.

## 2) Codex CLI

- npm package: `@openai/codex@0.98.0`
- CLI entry: `bin.codex = bin/codex.js`
- Node requirement: `>=16`
- Official repository: `openai/codex`
- Observation: repository combines `codex-rs` (Rust workspace with `tui` crate) and `codex-cli` (Node packaging layer), i.e. high-performance core + npm distribution.

## 3) OpenCode

- repository: `sst/opencode` (HEAD currently on `dev`)
- architecture: Bun-based monorepo
- core package: `packages/opencode`
- key dependencies include `@opentui/core`, `@opentui/solid`, and `@ai-sdk/openai-compatible`
- observation: TypeScript + modern TUI component stack + multi-provider abstraction.

## Recommended stack for this project

Given the target of fast delivery, npm installability, and only requiring baseURL + key:

- language/runtime: TypeScript on Node 18+
- TUI: Ink
- CLI parser: Commander
- model API: official OpenAI JavaScript SDK with configurable `baseURL`
- architecture: minimal single-package implementation first, then evolve toward pluginized multi-agent flows

This gives faster delivery than Rust TUI while staying lightweight and publish-friendly.
