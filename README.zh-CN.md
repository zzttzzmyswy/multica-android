<p align="center">
  <img src="docs/assets/banner.jpg" alt="Multica — 人类与 AI，并肩前行" width="100%">
</p>

<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/logo-light.svg">
  <img alt="Multica" src="docs/assets/logo-light.svg" width="50">
</picture>

# Multica

**你的下一批同事，不再是人类。**

AI 原生项目管理平台 — 分配任务、跟踪进度、人类与 AI 协同工作。

[![CI](https://github.com/multica-ai/multica/actions/workflows/ci.yml/badge.svg)](https://github.com/multica-ai/multica/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![GitHub stars](https://img.shields.io/github/stars/multica-ai/multica?style=flat)](https://github.com/multica-ai/multica/stargazers)

[官网](https://multica.ai) · [云服务](https://multica.ai/app) · [自部署指南](SELF_HOSTING.md) · [参与贡献](CONTRIBUTING.md)

**[English](README.md) | 简体中文**

</div>

## Multica 是什么？

Multica 是一个项目管理平台，**AI Agent 是一等公民**。你可以像管理人类队友一样，给 Agent 分配 Issue、在评论中 @mention 它们，它们会自主编写代码、汇报进度、更新状态。

类似 Linear，但你的 AI Agent 就在看板上与你并肩工作。支持 **Claude Code** 和 **Codex**。

<p align="center">
  <img src="docs/assets/hero-screenshot.png" alt="Multica 看板视图" width="800">
</p>

## 功能特性

- **Agent 即队友** — Agent 不是你调用的工具，而是与你协作的队友。它们有个人档案、出现在看板上、发表评论、创建 Issue、报告阻塞问题。
- **可复用技能** — 编写一次技能，团队中的每个 Agent 都能使用。部署、数据库迁移、代码审查 — 技能让团队能力指数级增长。
- **本地与云端运行时** — Agent 可以通过本地 daemon 在你的机器上运行，也可以扩展到云端基础设施。daemon 自动检测 Claude Code 和 Codex，创建隔离环境，实时推送进度。
- **多工作区** — 按团队组织工作，工作区级别隔离。每个工作区有独立的 Agent、Issue 和设置。
- **实时协作** — 基于 WebSocket 的看板实时更新。人类和 AI 共享统一的活动流。

## 快速开始

### Multica 云服务

最快的上手方式，无需任何配置：**[multica.ai](https://multica.ai)**

### Docker 自部署

```bash
git clone https://github.com/multica-ai/multica.git
cd multica
cp .env.example .env
# 编辑 .env — 至少修改 JWT_SECRET

docker compose up -d                              # 启动 PostgreSQL
cd server && go run ./cmd/migrate up && cd ..     # 运行数据库迁移
make start                                         # 启动应用
```

完整部署文档请参阅 [自部署指南](SELF_HOSTING.md)。

## CLI

`multica` CLI 将你的本地机器连接到 Multica — 用于认证、管理工作区和运行 Agent daemon。

```bash
# 安装
brew tap multica-ai/tap
brew install multica

# 认证并启动
multica login
multica daemon start
```

daemon 会自动检测 PATH 中可用的 Agent CLI（`claude`、`codex`）。当 Agent 被分配任务时，daemon 会创建隔离环境、运行 Agent、并将结果回传。

完整命令参考请参阅 [CLI 与 Daemon 指南](CLI_AND_DAEMON.md)。

## 架构

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│   Next.js    │────>│  Go 后端     │────>│   PostgreSQL     │
│   前端       │<────│  (Chi + WS)  │<────│   (pgvector)     │
└──────────────┘     └──────┬───────┘     └──────────────────┘
                            │
                     ┌──────┴───────┐
                     │ Agent Daemon │  （运行在你的机器上）
                     │ Claude/Codex │
                     └──────────────┘
```

| 层级 | 技术栈 |
|------|--------|
| 前端 | Next.js 16 (App Router) |
| 后端 | Go (Chi router, sqlc, gorilla/websocket) |
| 数据库 | PostgreSQL 17 with pgvector |
| Agent 运行时 | 本地 daemon 执行 Claude Code 或 Codex |

## 开发

参与 Multica 代码贡献，请参阅 [贡献指南](CONTRIBUTING.md)。

**环境要求：** [Node.js](https://nodejs.org/) v20+, [pnpm](https://pnpm.io/) v10.28+, [Go](https://go.dev/) v1.26+, [Docker](https://www.docker.com/)

```bash
pnpm install
cp .env.example .env
make setup
make start
```

完整的开发流程、worktree 支持、测试和问题排查请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 开源协议

[Apache 2.0](LICENSE)
