# Repository Guidelines

## Project Structure & Module Organization
- `src/` contains all runtime code.
  - Core runtime: `agent.ts`, `tools.ts`, `modes.ts`
  - CLI/TUI entrypoints: `cli.ts`, `ui.tsx`
  - Session/config/policy: `session.ts`, `config.ts`, `policy.ts`, `approvals.ts`, `audit.ts`
  - Extended integrations: `mcp.ts`, `mcp_client.ts`, `agents_runtime.ts`, `memory.ts`
- `docs/` stores research and supporting documentation.
- `dist/` is generated build output (do not edit manually).
- `README.md` is the user-facing usage guide.

## Build, Test, and Development Commands
- `npm install` — install dependencies.
- `npm run check` — TypeScript type check (`tsc --noEmit`).
- `npm run build` — compile to `dist/` with `tsup`.
- `npm run dev` — run CLI from source for local iteration.
- `npm run prepublish:check` — full gate: typecheck + build + `npm pack --dry-run`.

Examples:
- Start TUI: `node dist/cli.js run --mode auto`
- Single turn: `node dist/cli.js chat -m "review this repo" --mode ask`

## Coding Style & Naming Conventions
- Language: TypeScript (ESM, strict mode).
- Indentation: 2 spaces; keep functions short and single-purpose.
- Naming:
  - `camelCase` for variables/functions
  - `PascalCase` for types/classes
  - lower-case file names with underscores only when already established
- Prefer explicit return types for exported APIs.
- Keep side effects localized (I/O in dedicated modules).

## Testing Guidelines
- There is no dedicated unit test suite yet.
- Minimum validation for every change:
  1. `npm run check`
  2. `npm run build`
  3. Smoke-test affected commands (e.g., `run`, `chat`, `session`, `policy`, `agents`).
- For feature work, include at least one reproducible CLI example in PR notes.

## Commit & Pull Request Guidelines
- Git history is unavailable in this workspace snapshot; use Conventional Commits:
  - `feat: ...`, `fix: ...`, `chore: ...`, `docs: ...`
- PRs should include:
  - concise summary of behavior changes
  - commands used to validate
  - config/security impact (if touching `policy`, `approvals`, or tool execution)
  - screenshots or terminal output for TUI/CLI UX changes when relevant

## Security & Configuration Tips
- Never commit API keys or local auth/config files.
- Respect `.happycode-policy.json` and approval flow when enabling shell tools.
- Treat MCP server configs as trusted-code boundaries; verify commands before enabling.
