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
happycode init --base-url https://api.openai.com/v1 --api-key sk-xxx --model gpt-4o-mini
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
- `/test [command]` run tests and summarize failures
- `/fix` attempt issue investigation and fix flow
- `/context`, `/debug`, `/doctor` for diagnostics
- `/stats` and `/usage` for local usage summary
- `/tasks` and `/todos` for task extraction
- `/copy` copy latest assistant answer
- ask coding tasks in natural language
- `/mode ask|plan|edit|auto` switch runtime mode
- `/audit` show recent tool execution logs
- `/clear` clears session history
- `/exit` or `/quit` exits
- press `v` to toggle tool-call details (compact/verbose)
- type `/` to show command hints in TUI
- use `↑/↓` to select hints, `Tab` to autocomplete command
- when input is just `/`, press `Enter` to execute selected command (or insert if args needed)
- press `Esc` to clear current input quickly
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

- `ask`: read-only Q&A
- `plan`: read-only, produce implementation plan first
- `edit`: allow file editing tools
- `auto`: allow file editing + shell execution tools

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
- `run_shell` (only in `auto` mode)
- `git_status`
- `git_diff`
- `git_log`

## Production safety

- Shell execution is validated by a safety policy (dangerous patterns blocked)
- Mode policy gates write/exec permissions
- Tool calls are audited to `~/.happycode/audit.log` by default
- Sensitive path writes can be blocked by `.happycode-policy.json`
- Shell commands require explicit approval prefix before execution

Audit helpers:

```bash
happycode audit --path
happycode audit --tail 30
```

Disable audit:

```bash
happycode run --no-audit
happycode chat -m "status" --mode ask --no-audit
```

## Command approval flow

When shell execution is requested, the tool may reply with:

`Approval required. Run in TUI: /allow once <command> or /allow session <command>`

TUI commands:

- `/allow once <command>`
- `/allow session <prefix>`
- `/approvals`
- `/approvals clear`

CLI helpers:

```bash
happycode approvals --path
happycode approvals --list
happycode approvals --clear
```

## Policy file

Initialize policy in project root:

```bash
happycode policy --init
happycode policy --path
```

File: `.happycode-policy.json`

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
