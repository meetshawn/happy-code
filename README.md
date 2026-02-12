# HappyCode TUI

A coding-focused TUI tool compatible with OpenAI-style APIs.

You only need:

- `baseURL`
- `apiKey`
- optional `model`

Then you can use it directly in terminal.

## Install

### Local development

```bash
npm install
npm run build
node dist/cli.js run
```

### Global install (after publish)

```bash
npm install -g happy-code-tui
happycode run
```

### Global use from current source repo

```bash
npm install
npm run build
npm link
```

After that, `happycode` is available in any directory.

## Initialize config

```bash
happycode init --base-url https://api.openai.com/v1 --api-key sk-xxx --model gpt-4o-mini --max-turns 24
```

Config path:

- Windows: `%USERPROFILE%/.happycode/config.json`
- macOS/Linux: `~/.happycode/config.json`

## Run

```bash
happycode run
```

In TUI:

- `/help` show command help
- `/status` show runtime status
- `/config` show config + runtime overrides
- `/theme [black-yellow|cyber|minimal]` switch welcome theme
- `/new` start a new conversation
- `/compact` keep only latest context messages
- `/review` review current git diff and risks
- `/plan` generate implementation plan
- `/solve` enter solve phase for active plan state
- `/test [command]` run tests and summarize failures
- `/fix` attempt issue investigation and fix flow
- `/context`, `/debug`, `/doctor` for diagnostics
- `/stats` and `/usage` for local usage summary
- `/tasks` and `/todos` for persisted task-state views
- `/copy` copy latest assistant answer
- ask coding tasks in natural language
- `Shift+Tab` quick-switch mode (`plan -> edit -> auto`)
- `/audit` show recent tool execution logs
- `/memory` open memory file picker
- `/memory user|project` open memory file directly
- `/clear` clears session history
- `/exit` or `/quit` exits
- type `/` to show command hints in TUI
- use `↑/↓` to browse previous input drafts when no picker/question is open
- use `↑/↓` to select hints, `Tab` to autocomplete command
- when input is just `/`, press `Enter` to execute selected command (or insert if args needed)
- press `Esc` to clear current input quickly
- while a task is running: press `Esc` once to interrupt; press `Esc` again within 1.2s to open rollback choices
- use `!<command>` for quick shell workflow via agent tools
- use `@path/to/file` in prompt to include file content context

## Advanced CLI options

For `run` and/or `chat`:

- `--model <name>`
- `--fallback-model <name>`
- `--max-turns <n>`
- `--allowed-tools <csv>`
- `--disallowed-tools <csv>`
- `--system-prompt <text>`
- `--append-system-prompt <text>`

`max-turns` resolution order:

- CLI `--max-turns` override
- config `maxTurns` from `happycode init --max-turns`
- fallback default `24`

Recommended ranges:

- `8-12`: small Q&A and tiny edits
- `16-24`: normal coding tasks (recommended)
- `32+`: larger multi-step tasks (higher cost/latency)

If you see `Stopped after max tool turns (...)`, increase `--max-turns` or split the task into smaller phases.

`chat` output modes:

- `--json`
- `--stream-json`

Multi-agent orchestration:

```bash
happycode agents -m "design and implement feature X"
```

This runs planner/coder/reviewer sub-agents and merges outputs.

## Session lifecycle

Examples:

```bash
happycode session --list
happycode session --new feature_x
happycode session --resume <sessionId>
happycode session --fork feature_x_fix
happycode session --rewind 4
happycode run --resume <sessionId>
```

## Memory system

HappyCode injects persistent memory into system prompt dynamically on each turn.

- User memory (global): `~/.happycode/memory_user.md`
- Project memory (per repo): `<project>/.happycode/memory_project.md`

Legacy compatibility:

- If legacy `<project>/.happycode-memory.md` exists and new path is missing, HappyCode auto-migrates to `.happycode/memory_project.md` on access.

Edit memory by opening files via `/memory` and updating content manually.

Injection policy:

- always enabled in `run`, `chat`, and `agents`
- soft constraints only
- explicit user request in current turn has higher priority

## MCP runtime integration

MCP config file in project root:

```bash
happycode policy --path
happycode run
```

Inside TUI:

- `/mcp` show connected/discovered MCP tools
- `/mcp init` scaffold MCP config
- MCP tools are dynamically exposed as callable tools (`mcp__server__tool`)

Mode policy summary:

- `plan`: read-only; produces structured plans and persists plan/task state files
- `edit`: allow file editing + shell execution (with safety policy + approval flow)
- `auto`: allow file editing + shell execution tools (no approval/safety gating)

Plan-and-solve state files:

- plans: `~/.happycode/plans/<planId>.md` and `~/.happycode/plans/<planId>.meta.json`
- tasks markdown source-of-truth: `~/.happycode/plans/<planId>.md`
- compatibility snapshot/events: `~/.happycode/tasks/<planId>.json` and `~/.happycode/tasks/<planId>.events.ndjson`
- when in `plan` mode, generated actionable plans are auto-persisted and bound to the active session
- legacy task snapshots (`tasks/<planId>.json`) are auto-migrated into markdown plan state when needed

Progress tracking behavior:

- `/tasks` shows phase, progress (`done/total` + percent), current active task, and blocked count
- `/todos` renders checklist from persisted state snapshot
- markdown checkboxes are state source: `[ ]` todo, `[-]` doing, `[x]` done
- in solve phase, assistant can append control lines to advance state:
  - `TASK_STATE: done|blocked|doing`
  - `TASK_NOTE: <short note>` (optional)

Interrupt & rollback behavior:

- first `Esc` during `Thinking...` interrupts current run
- second `Esc` within 1.2 seconds opens a visible rollback-point list (use `↑/↓`, `Enter`)
- after selecting a history item, confirm rollback mode:
  - rollback code + dialogue
  - rollback dialogue only
  - keep current state
- rollback-point list only includes entries with valid snapshots
- rollback status is shown in status/error line, and no extra chat message is appended

## Session persistence

- session file path: `happycode session --path`
- clear persisted session: `happycode session --clear`

By default, session is stored at:

- Windows: `%USERPROFILE%/.happycode/session.json`
- macOS/Linux: `~/.happycode/session.json`

## Built-in coding tools

- `list_files`
- `read_file`
- `write_file`
- `append_file`
- `patch_file`
- `delete_file`
- `search_in_files`
- `run_shell` (`edit` requires safety policy + approval, `auto` runs directly)
- `git_status`
- `git_diff`
- `git_log`
- `user_question`

## Production safety

- Shell execution is validated by safety policy outside `auto`
- Mode policy gates write/exec permissions
- Tool calls are audited to `~/.happycode/audit.log` by default
- Sensitive path writes can be blocked by `.happycode-policy.json`
- Shell commands may require explicit approval (once / session / deny) outside `auto`

Audit helpers:

```bash
happycode audit --path
happycode audit --tail 30
```

Disable audit:

```bash
happycode run --no-audit
happycode chat -m "status" --mode plan --no-audit
```

## Command approval flow

When shell execution is requested outside `auto`, TUI will prompt 4 choices:

- allow once (exact command, one-time)
- allow in session (prefix in current session)
- allow global (prefix across sessions)
- deny

Notes:

- even when a command is blocked by policy prefix/deny checks, TUI still opens approval prompt
- choosing allow once/session/global runs the current command immediately

TUI commands:

- `/allow once <command>`
- `/allow session <prefix>`
- `/allow global <prefix>`
- `/approvals`
- `/approvals clear`
- `/approvals clear global`

CLI helpers:

```bash
happycode approvals --path
happycode approvals --list
happycode approvals --clear
happycode approvals --list-global
happycode approvals --clear-global
```

## Policy file

Initialize policy in project root:

```bash
happycode policy --init
happycode policy --path
happycode policy --global-init
happycode policy --global-path
```

File: `.happycode-policy.json`

Global file: `~/.happycode/policy.json`

Precedence: project policy overrides global policy; global policy overrides built-in defaults.

Supports:

- `allowShellPrefixes`
- `denyShellPatterns`
- `protectedPaths`

## Non-interactive mode

```bash
happycode chat -m "scan project and propose refactor" --mode plan
```

## Pre-publish check

```bash
npm run prepublish:check
```

This runs type check, build, and `npm pack --dry-run`.

## Research notes

See `docs/research.md`.
