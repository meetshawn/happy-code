# HappyCode TUI 项目分析

## 项目概述

**HappyCode TUI** 是一个专注于编码的终端用户界面（TUI）工具，兼容 OpenAI 风格的 API。它允许用户通过自然语言与代码库进行交互，提供多种运行模式来控制工具的权限和行为。

### 基本信息

- **项目名称**: happy-code-tui
- **版本**: 0.1.0
- **类型**: ESM Module
- **运行时**: Node.js >= 18
- **许可证**: MIT

## 技术栈

### 核心依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| `ink` | ^5.2.1 | React 风格的 CLI UI 框架 |
| `openai` | ^6.6.0 | OpenAI API 客户端 |
| `react` | ^18.3.1 | UI 渲染 |
| `commander` | ^14.0.1 | CLI 命令行解析 |
| `fast-glob` | ^3.3.3 | 文件系统 glob 搜索 |

### 开发依赖

- `typescript` - TypeScript 编译器
- `tsup` - 打包工具
- `tsx` - TypeScript 执行器

## 项目结构

```
src/
├── agent.ts      # 核心 Agent 类，处理 OpenAI 调用和工具编排
├── cli.ts        # CLI 命令入口 (init, run, chat, session)
├── config.ts     # 配置文件读写
├── modes.ts      # 运行模式定义 (ask, plan, edit, auto)
├── session.ts    # 会话持久化管理
├── tools.ts      # 内置工具实现 (9个工具)
└── ui.tsx        # React/ink TUI 组件
```

## 核心功能

### 1. 运行模式 (Modes)

项目定义了 4 种运行模式，每种模式有不同的权限策略：

| 模式 | 写权限 | 执行权限 | 描述 |
|------|--------|----------|------|
| `ask` | ❌ | ❌ | 只读问答模式 |
| `plan` | ❌ | ❌ | 只读，先生成实现计划 |
| `edit` | ✅ | ❌ | 允许文件编辑，不允许 Shell |
| `auto` | ✅ | ✅ | 允许编辑和安全 Shell 命令 |

### 2. 内置工具 (9个)

| 工具名 | 参数 | 功能 |
|--------|------|------|
| `get_context` | - | 获取执行上下文和模式策略 |
| `list_files` | pattern | 按 glob 模式列出文件 |
| `read_file` | path | 读取文件内容（限制 30KB） |
| `write_file` | path, content | 创建或覆盖文件 |
| `append_file` | path, content | 追加内容到文件 |
| `patch_file` | path, find, replace | 替换首次匹配的文本 |
| `delete_file` | path | 删除文件 |
| `search_in_files` | pattern, glob | 跨文件搜索文本 |
| `run_shell` | command, timeout_ms | 执行 Shell 命令（仅在 auto 模式） |

### 3. CLI 命令

#### `happycode init`
初始化配置，保存 API 信息：
```bash
happycode init --base-url <url> --api-key <key> [--model <model>]
```

#### `happycode run`
启动 TUI 交互界面：
```bash
happycode run [--mode ask|plan|edit|auto]
```

#### `happycode chat`
单次非交互式对话：
```bash
happycode chat -m "message" --mode ask
```

#### `happycode session`
会话管理：
```bash
happycode session --path   # 显示会话文件路径
happycode session --clear  # 清除会话历史
```

## 架构设计

### Agent 工作流程

```
用户输入
   ↓
[系统提示 + 模式提示]
   ↓
OpenAI API 调用 (带工具 Schema)
   ↓
解析响应
   ↓
├─ 文本回复 → 直接输出
└─ 工具调用 → 执行工具 → 将结果加入历史 → 继续调用
   ↓
达到最大轮次 (默认 8 轮) 或没有更多工具调用 → 结束
```

### 安全机制

1. **路径隔离**: 所有文件操作限制在 `cwd` 内，防止路径逃逸
2. **模式策略**: 根据模式限制工具权限
3. **输出限制**: 文件读取限制 30KB，命令输出限制 20KB
4. **超时保护**: Shell 命令默认 30 秒超时
5. **忽略规则**: 自动忽略 `node_modules`, `.git`, `dist`, `build`

### 配置存储

| 平台 | 配置路径 |
|------|----------|
| Windows | `%USERPROFILE%/.happycode/config.json` |
| macOS/Linux | `~/.happycode/config.json` |

会话文件同样存储在 `.happycode/session.json`

## 使用场景

1. **代码审查**: 使用 `ask` 模式只读分析代码
2. **方案设计**: 使用 `plan` 模式生成实施计划
3. **代码重构**: 使用 `edit` 模式修改多个文件
4. **自动化任务**: 使用 `auto` 模式运行构建、测试等命令

## 打包与发布

```bash
npm run build          # 使用 tsup 打包
npm run check          # TypeScript 类型检查
npm run prepublish:check  # 发布前检查
```

打包产物：
- `dist/cli.js` - CLI 入口
- `dist/index.js` - 库入口
- 对应的 `.d.ts` 类型声明文件

## 特色亮点

1. **轻量级**: 无需复杂配置，只需 base URL 和 API key
2. **模式驱动**: 清晰的权限分层，降低误操作风险
3. **会话持久**: 自动保存对话历史，跨会话恢复
4. **流式输出**: 支持实时流式显示 AI 响应
5. **灵活兼容**: 支持任何 OpenAI 兼容的 API（如本地 Ollama、Azure 等）

## 潜在改进方向

1. 支持多会话并行
2. 添加更多代码分析工具（如 AST 解析、依赖图）
3. 支持自定义工具插件
4. 添加代码补全/内联建议功能
5. 支持远程工作区（如 GitHub 仓库）
6. 添加更多输出格式（JSON、Markdown 等）
