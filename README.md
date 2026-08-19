# Multica Android（第三方/社区安卓客户端）

> ⚠️ **非官方项目（Non-official）**：本仓库是**社区成员维护的第三方安卓客户端**，与 Multica 官方（multica-ai / devv.ai）**无关联、不构成任何官方背书**。"Multica" 名称与品牌标识归其官方所有，本项目仅以兼容兼容其自部署服务与协议为目标。

一个面向 **Multica**（开源的 managed-agents 工作平台）的安卓客户端 —— 在手机上查收工作区、issue、agent、执行记录、聊天等，**功能持续对齐 Multica Web 端**。

- 技术栈：Expo SDK 55 / React Native 0.83，复用官方移动端跨平台基座（`apps/mobile`）
- 渠道：GitHub 预编译 Release（按 ABI 分包 + App 内「检查更新」）
- 目标：**APK 功能 100% 对齐 web 端**（长期迭代使命）

---
**简体中文** · [English Summary](#english)

---

## 功能一览

- 收件箱 / 项目 / 我的问题 / 已固定 / 聊天 / 更多 底部导航
- 聊天：会话、agent 流式执行过程（思考/工具）、键盘适配、宽表格横滑
- Issue：列表/详情/评论、Markdown 工具栏、附件上传、批量操作、订阅/重跑、运行记录
- Agent：列表/详情管理、创建（表单 + AI-builder 对齐 web「通过智能体创建」）
- 自动化（Autopilot）、Squad、Label、Members、Skills、Runtimes、用量看板、MCP 配置
- 设置：工作区管理、语言/时区偏好、API Token 管理
- 关于页 + 应用内更新（GitHub Release 检测 → 带进度的下载 → 系统安装器）
- 统一「下载」管理器：文件与 APK 更新任务同屏

## 上游借用清单

本仓库是一个 **fork**：基于官方开源仓库 [multica-ai/multica](https://github.com/multica-ai/multica) 派生而来，**完整保留了官方 monorepo 的全部上游代码**，并在此基础上做安卓客户端适配。

### 借用了上游的哪些代码

| 来源 | 内容 | 说明 |
|---|---|---|
| 官方 monorepo | `server` / `cli` / `daemon` / `deploy` / Makefile | 官方服务的部署与开发基础设施，保留未动 |
| 官方 `packages/core` / `packages/shared` | 数据模型、API 客户端、类型、i18n 等共享层 | 直接复用（含跨端镜像到 `apps/mobile/data`、`lib` 的 mirror 实现） |
| 官方 `packages/views` | Web/桌面端共享视图层 | 作为功能对齐的参照实现；移动端按需镜像关键逻辑 |
| 官方 `apps/mobile` | **移动端基座**（Expo / React Native / 原生配置） | 本仓库安卓工作的主载荷；大部分原样保留官方 iOS-first 代码 |
| 官方 `apps/web` / `apps/desktop` | Web 与桌面应用 | 保留，用于对照与共享品牌资源（如 Star 图标） |
| 官方 `docs` / `LICENSE` / `CLAUDE.md` 等 | 文档与许可 | 保留原样（LICENSE 为上游 Multica License，见下） |

> 变更范围收敛：本仓库与上游的差异**集中在 `apps/mobile` 的安卓适配与功能补齐**；为便于对照，`main` 分支基于官方 main 演进，差异可随时用 `git diff` 查看。

### 本项目新增 / 修改的部分（自研安卓工作）

- Android **edge-to-edge 键盘适配**：聊天/表单输入框随键盘上移（`KeyboardStickyView`）、`tabBarHideOnKeyboard`
- 聊天**「思考中」任务级轮询兜底**、agent **执行过程流式 trace 兜底**（应对移动网络 WS 丢事件）
- **关于页 + 应用内更新**：GitHub Release 检测、按 ABI 匹配、带进度下载、唤起系统安装器、未知源引导
- **统一下载管理器**：文件下载与 APK 更新任务统一展示
- 宽表格 / 代码块**横向滑动**；Hermes 兼容修复（ES2023 特性规避）
- 大量对齐 web 的页面与交互（详见上方功能一览，含批量操作、AI-builder 创建、MCP 配置等）
- Android 构建/发布管线：**ABI 拆分**（arm64-v8a / armeabi-v7a / x86_64 / x86）、`verify-apk` 校验

## 安装与更新

- **正式渠道**：[GitHub Releases](https://github.com/zzttzzmyswy/multica-android/releases) 下载对应 ABI 的 APK（arm64-v8a 为主力手机 ABI）
- **App 内更新**：关于页 →「检查更新」→ 检测到新版本后自动下载（带进度）→ 系统安装器
- 版本命名：语义化（功能集 → minor，纯修复 → patch），如 v0.x.y；与官方上游版本线无关
- 包名 `ai.multica.mobile.dev`，minSdk 24

## 开发

```bash
# 需要 Android SDK（NDK/JDK17）与 pnpm
git clone https://github.com/zzttzzmyswy/multica-android.git
cd apps/mobile && pnpm install
# 构建 release（全 ABI 或按 `-PreactNativeArchitectures=arm64-v8a` 指定）
cd android && ANDROID_HOME=/path/to/sdk ./gradlew assembleRelease
```

测试与校验：`pnpm test`（vitest）、`npx tsc --noEmit`、`pnpm verify:apk`。

> 完善的上游本地开发工作流（`make dev` / worktree / postgres）见官方 `CONTRIBUTING.md`，本仓库保留全部上游代码可直接沿用。

## 许可与商标

- 本仓库**继承上游许可**：[Multica License](LICENSE)（Apache License 2.0 + Part I 附加条件），参与贡献即同意按该许可整体授权。
- **"Multica" 及其品牌标识为官方所有**；本项目的使用仅为兼容性引用，不暗示官方关联或认可。
- 本项目按原样（AS-IS）提供，无任何官方支持承诺；维护与问题处理以社区意愿为准。

## 免责声明

本客户端为社区志愿者维护，可能存在与官方功能、协议或图形资源的偏差；请勿将其用于需要完全一致官方体验的关键流程。如遇问题欢迎提 issue，但响应与修复以维护者空闲时间为准。

---

## English

**Multica Android** is an **unofficial, community-maintained Android client** for the open-source [Multica](https://github.com/multica-ai/multica) managed-agents platform. It is **not affiliated with or endorsed by the Multica team**.

It is a **fork of the official `multica-ai/multica` monorepo** that keeps all upstream code intact (server, CLI/daemon, shared packages, web/desktop apps) and adds Android-specific work concentrated in `apps/mobile` — including edge-to-edge keyboard handling, resilient chat task polling, an About page with in-app updates from GitHub Releases (progress + system installer), a unified Downloads manager, and many Web-aligned screens. The official mobile base (`apps/mobile`, Expo/React Native) and shared packages (`packages/core`, `packages/shared`) are reused as-is or mirrored per the "mirror, don't import" rule.

Licensed under the upstream **Multica License** (Apache-2.0 + additional conditions); "Multica" assets belong to their official owners. Install from [GitHub Releases](https://github.com/zzttzzmyswy/multica-android/releases) (per-ABI APKs, minSdk 24).