# 关于页 + GitHub Release 更新 设计

日期：2026-08-16
状态：已确认（MYSWY 拍板：方案 A 内置安装器 / 启动静默+手动检查 / More 入口）

## 1. 目标

安卓客户端新增两块能力：

1. **关于页**：展示应用图标/名称、当前版本（versionName + versionCode）、简介、GitHub 仓库链接。
2. **更新功能**：从 GitHub Release（`zzttzzmyswy/multica-android`）获取最新版本，与当前版本比较；发现新版可**内置下载 → 唤起系统安装器**完成更新；**启动时静默检测** + **关于页手动检查**双入口。

## 2. 范围

- 仅移动端改动（Expo/RN），无服务端变更。
- 更新源固定为 GitHub 公开 Release（`api.github.com/repos/zzttzzmyswy/multica-android/releases/latest`）。
- 仅稳定版：跳过 `prerelease` / `draft`。
- ABI 匹配：按设备 ABI 从 release assets 中挑选对应 APK（arm64-v8a / armeabi-v7a / x86_64 / x86）。

## 3. 组件设计

### 3.1 版本读取 `lib/app-version.ts`
- 当前版本：`Constants.expoConfig?.version`（app.config.ts `version: "0.1.0"`）。
- 语义化版本比较 `compareVersions(a, b)`：纯函数，返回 `-1 | 0 | 1`；`0.1.0 < 0.10.0`；非法输入抛错/返回 0（有单测）。
- 常量：`GITHUB_REPO = "zzttzzmyswy/multica-android"`、`GITHUB_RELEASES_API`、`ABI_TO_ASSET_MARKER`。

### 3.2 Release 解析 `lib/release-check.ts`（纯函数，全部单测）
- `parseLatestRelease(json)`：从 GitHub API 响应提取 `{ tag_name, name, published_at, assets: [{name, browser_download_url, size}] }`。
- `matchAssetForAbi(assets, abi)`：按 `abi` 关键字（`arm64-v8a` 等）从 `.apk` 资产中挑选；找不到返回 `null`。
- `isNewer(tagName, currentVersion)`：剥 `v` 前缀后 `compareVersions > 0`。

### 3.3 数据层 `lib/use-latest-release.ts`
- `useLatestRelease(enabled)`：基于 `@tanstack/react-query` 的 hook，调用 GitHub API（`staleTime` 适中，如 10 分钟）。
- 启动静默检测：在 workspace 根布局挂一个轻量 Provider `UpdateProvider`，挂载时触发一次 `useLatestRelease(true)`，`hasUpdate` 状态存进内存 store（`data/update-store.ts`），More 页「关于」条目据此显示「新版本可用」红点/徽标。
- 手动检查：关于页「检查更新」按钮 `refetch()`，失败显示可读错误。

### 3.4 下载与安装 `lib/install-update.ts`
- 下载：`expo-file-system` 下载 APK 到 `cacheDirectory/multica-update-v<tag>-<abi>.apk`（已有依赖）。
- 安装：`expo-intent-launcher`（需新增依赖）+ FileProvider：
  - `content://` URI（expo-file-system 已提供 FileProvider 域）+ `ACTION_VIEW`，MIME `application/vnd.android.package-archive`，`FLAG_GRANT_READ_URI_PERMISSION`。
- 未知源引导：`ACTION_MANAGE_UNKNOWN_APP_SOURCES`（`Settings`），首次安装被拒/无权限时引导。
- 失败处理：下载失败/安装失败 → Alert 可读错误；下载期间禁用按钮显示进度。

### 3.5 关于页 `app/(app)/[workspace]/more/about.tsx`
- 内容：应用图标（复用 header 风格）、名称 **Multica**、副标题（安卓客户端）、当前版本 `v0.1.0 (1)`、简介一行、GitHub 链接（`Linking.openURL`）、「检查更新」+ 更新状态/下载按钮。
- 入口：`more/index.tsx`（或现有 more 列表）新增「关于」条目（图标 + 文案，i18n 中英）。
- i18n：新增 `about.*` 与 `update.*` 文案到 `en.json` / `zh.json`（项目已用 i18n 体系）。

## 4. 数据流

```
启动 / 进入 workspace
  → UpdateProvider mount → fetch latest release(GitHub API)
  → isNewer? → 有更新：store.hasUpdate=true（More 页「关于」徽标）
关于页
  → 手动「检查更新」→ refetch → 显示「最新版 vX 或 已有新版 vX」
  → 点「下载并安装」→ 按 ABI 匹配资产 → 下载(cache) → FileProvider intent → 系统安装器
```

## 5. 错误处理

- 网络/GitHub 不可达：静默检测不打扰用户；手动检查显示「无法连接，请稍后重试」。
- release 无匹配 ABI：手动检查显示「当前设备架构暂未发布安装包」。
- 下载失败/安装失败：Alert 展示错误；下载中断可重试。
- 版本比较非法：视为无更新（不弹错）。

## 6. 依赖变更

- 新增 `expo-intent-launcher`（`pnpm add expo-intent-launcher`，Expo 官方模块）。
- 复用：`expo-file-system`、`expo-constants`（已在依赖）。

## 7. 测试与验收

- 单测（vitest）：`compareVersions`、`parseLatestRelease`、`matchAssetForAbi`、`isNewer` 边界（pre/draft 跳过、v 前缀、多 ABI 资产选择、无匹配返回 null）。
- `tsc --noEmit` 通过；全量 vitest 通过。
- 构建全 ABI release；模拟器/真机验证：关于页显示、GitHub 链接可开、手动检查正常（v0.1.0 == latest → 显示已最新）、构造更高版本 tag 场景用单测覆盖；安装流程在模拟器用已构建 APK 验证到「系统安装器确认页」。
- 交付：arm64-v8a APK；成功后可选发 GitHub Release v0.1.1。

## 8. 非目标（YAGNI）

- 不做增量/分片下载、不做强制更新、不做安装前哈希校验（资产来自可信 GitHub 通道，作为后续增强项记录）。
- 不做更新渠道管理（仅 GitHub 单源）。
