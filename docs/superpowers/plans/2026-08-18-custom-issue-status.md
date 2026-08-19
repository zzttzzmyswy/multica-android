# 移动端自定义 Issue 状态对齐 web（MUL-6243）实现计划

> **For agentic workers:** 按本计划逐任务执行，每任务含测试/验证/提交。

**Goal:** 移动端 Issue 状态层由「固定 7 态硬编码」改造为 catalog 驱动，与 web（PR #7103）对齐：类型打开、catalog 数据层、分类折叠分组、CustomStatusChip、选择器/过滤器分组、Settings 管理 tab；无自定义状态/服务器未部署时行为与现状完全一致。

**Architecture:** 共享类型在 `packages/core/types`（上游已同款放宽）；catalog 解析器为纯函数放 `lib/issue-status-catalog.ts`（leaf，无 React）；查询/写路径放 `data/{queries,mutations}/issue-statuses.ts`；展示面经 `useStatusLabel`/`useStatusOptions`/`CustomStatusChip` 统一解析。内置名永远走 i18n，自定义名走 catalog，未知回退裸 key。

**Tech Stack:** Expo 55 / React Native 0.83 / TanStack Query v5 / Zustand / zod / vitest

## Global Constraints

- `IssueStatus = IssueStatusCategory | (string & {})`（打开）；`IssueStatusCategory` 保持 7 项闭联合（与上游一致）。
- 内置名永不经过 catalog 的服务器英文名（非英文工作区不能看 "In Progress"）——唯一规则收敛在 status label 解析。
- 无自定义状态 = 渲染与现状逐像素一致；catalog GET 404/错误 → 空目录（内置 7 态照常），不阻塞任何展示面。
- board 列保持 6 列（BOARD_STATUSES，cancelled 不入列，现状对齐）。
- 新增 i18n 键 en/zh 同步 + parity 测试保持全绿。
- 只用既有依赖；拖拽重排改为行进上下移按钮（不引新依赖）。
- 目录:任务 TDD；每次完成跑 `apps/mobile` 单测。

---

### Task 1: 共享类型地基（@multica/core/types）

**Files:**
- Modify: `packages/core/types/issue.ts`
- Create: `packages/core/types/issue-status.ts`
- Modify: `packages/core/types/index.ts`

**Interfaces:**
- Produces: `IssueStatusCategory`（7 项闭联合）、`IssueStatus = IssueStatusCategory | (string & {})`、`Issue.status_category?: IssueStatusCategory`、`IssueStatusEntry`、`ListIssueStatusesResponse`、`CreateIssueStatusRequest`、`UpdateIssueStatusRequest`（全部由 `@multica/core/types` 导出）

- [ ] **Step 1:** 在 `packages/core/types/issue.ts` 顶部插入 `IssueStatusCategory` 类型与扩充后的 `IssueStatus`；在 `Issue` 接口 `status` 后加 `status_category?: IssueStatusCategory;`（照抄上游 e3a40b0b8 同文件 diff）。
- [ ] **Step 2:** 新建 `packages/core/types/issue-status.ts`（IssueStatusEntry / ListIssueStatusesResponse / CreateIssueStatusRequest / UpdateIssueStatusRequest，照上游）。
- [ ] **Step 3:** `packages/core/types/index.ts` 增加导出：`export type { IssueStatusCategory } from "./issue";` 及 `export type { IssueStatusEntry, ListIssueStatusesResponse, CreateIssueStatusRequest, UpdateIssueStatusRequest } from "./issue-status";`
- [ ] **Step 4:** 全 monorepo 快速 typecheck 确认不破坏 fork 内 web/desktop 消费方：`pnpm -w typecheck` 或逐包 `tsc --noEmit`；出现穷举 switch 报错则加 `default:` 分支（上游同款修复）。
- [ ] **Step 5: Commit** `feat(mobile): widen IssueStatus + add catalog types (MUL-6243)`

### Task 2: 纯 catalog 层（lib）

**Files:**
- Modify: `apps/mobile/lib/issue-status.ts`
- Create: `apps/mobile/lib/issue-status-catalog.ts`
- Test: `apps/mobile/lib/issue-status-catalog.test.ts`
- Modify: `apps/mobile/lib/filter-issues.ts`（groupIssues 按 category 折叠）

**Interfaces:**
- Consumes: `IssueStatusCategory` / `IssueStatus` / `IssueStatusEntry`（core types）
- Produces:
  - `ISSUE_STATUS_CATEGORIES: IssueStatusCategory[]`、`isIssueStatusCategory(key): key is IssueStatusCategory`、`statusCategoryOfKey(key): IssueStatusCategory`（内置即自身，未知回退 "todo"）
  - `issueStatusCategoryOfIssue(issue): IssueStatusCategory | null`（`status_category` 优先，其次内置 key，其次 null）
  - `normalizeStatusPatch(patch: Partial<Issue>): Partial<Issue>`（改 status 时同步回填 status_category）
  - `IssueStatusCatalog` + `buildIssueStatusCatalog(entries, {isPending,isError,retry})` + `compareIssueStatusEntries`
  - `groupIssues` status 路径：新增可选 `statusCategoryOf?: (issue) => IssueStatusCategory | null` 参数，默认 `issueStatusCategoryOfIssue`；section 的 key/status 语义改为「类别」

- [ ] **Step 1:** 写 `lib/issue-status-catalog.test.ts`：catalog 解析（内置/自定义/未知回退 todo/archived 排除 activeStatuses/hasCustomStatuses/isError 语义）、compareIssueStatusEntries 排序、statusCategoryOfKey 回退、groupIssues 类别折叠（自定义订入所属类别列 + 空列保留 + board includeEmpty）+ 无自定义时与旧 key 分组等价 + defaultCategory 兜底为 null 时按 status 原 key 的向后兼容。
- [ ] **Step 2:** 跑测试确认红。
- [ ] **Step 3:** 实现 lib 改动。
- [ ] **Step 4:** 跑测试确认绿；再跑 `npm run test -- lib/filter-issues` 既有测试全绿。
- [ ] **Step 5: Commit** `feat(mobile): catalog builder + category grouping (MUL-6243)`

### Task 3: 数据层（api + queries + mutations）

**Files:**
- Modify: `apps/mobile/data/api.ts`
- Modify: `apps/mobile/data/schemas.ts`
- Create: `apps/mobile/data/queries/issue-statuses.ts`
- Create: `apps/mobile/data/mutations/issue-statuses.ts`
- Test: `apps/mobile/data/mutations/issue-statuses.test.ts`、`apps/mobile/data/queries/issue-statuses.test.ts`（如可行）

**Interfaces:**
- Consumes: Task1 类型、Task2 纯函数
- Produces:
  - `api.listIssueStatuses(opts?: {includeArchived?, signal?})`（404 防御→空目录）、`api.createIssueStatus(data)`、`api.updateIssueStatus(id,data)`、`api.archiveIssueStatus(id)`、`api.reorderIssueStatuses(category,ids)`
  - `issueStatusKeys`、`issueStatusListOptions(wsId)`（staleTime 5min）、`useIssueStatuses(wsId): IssueStatusCatalog`
  - `useCreateIssueStatus`/`useUpdateIssueStatus`（乐观更新+再排序）/`useArchiveIssueStatus`（非乐观）/`useReorderIssueStatuses`（乐观再排序）；onSettled 失效 catalog + issue 列表

- [ ] **Step 1:** `schemas.ts` 增 `IssueStatusEntrySchema`/`EMPTY_ISSUE_STATUS_ENTRY`/`ListIssueStatusesResponseSchema`/`EMPTY_LIST_ISSUE_STATUSES_RESPONSE`。
- [ ] **Step 2:** `api.ts` 增 5 方法（list 的 404 捕获镜像 listProperties 防御式处理；create 走裸 fetch 与 createLabel 一致；update/archive 走 parseWithFallback）。
- [ ] **Step 3:** 建 `data/queries/issue-statuses.ts`（keys/options/hook）。
- [ ] **Step 4:** 建 `data/mutations/issue-statuses.ts`（镜像 labels.ts 模式 + web mutations 的乐观/失效策略）。
- [ ] **Step 5:** 复跑 `apps/mobile` 全单测 + tsc。
- [ ] **Step 6: Commit** `feat(mobile): issue-status catalog queries + mutations (MUL-6243)`

### Task 4: 展示面接线（picker/filter/board/chip/详情/表格/inbox）

**Files:**
- Modify: `apps/mobile/components/ui/status-icon.tsx`（+`category?`/`color?` props，custom color 优先，glyph 按 category）
- Create: `apps/mobile/lib/status-options.ts`（`useStatusLabel(wsId)` + `useStatusOptions(wsId)`：groups/options/hasCustom）
- Create: `apps/mobile/components/issue/custom-status-chip.tsx`（+`useIsCustomStatus`；内置不渲染）
- Modify: `apps/mobile/components/issue/pickers/status-picker-body.tsx`（catalog 分组、hasCustom 时显示组头、色点）
- Modify: `apps/mobile/app/(app)/[workspace]/issues-filter.tsx`（status 过滤列表 catalog 分组）
- Modify: `apps/mobile/components/issue/board-view.tsx`（列头 label/icon 走 catalog；卡片长按 move 菜单用 useStatusOptions）
- Modify: `apps/mobile/components/issue/board-card.tsx` / `issue-row.tsx`（CustomStatusChip + catalog label/icon）
- Modify: `apps/mobile/components/issue/attribute-row.tsx` / `create-form-attribute-row.tsx`（详情/新建 label 走 useStatusLabel）
- Modify: `apps/mobile/components/issue/issue-surface-chrome.tsx`（section header label 走 useStatusLabel）
- Modify: `apps/mobile/components/issue/table-view.tsx`（状态列 label/icon + CSV ctx statusLabels 走 catalog）
- Modify: `apps/mobile/lib/format-activity.ts`（activity 状态名：新增可选 resolver 参数）
- Modify: `apps/mobile/lib/issue-table-export.ts`（statusLabels 语义注释/兼容）
- Modify: `apps/mobile/components/inbox/detail-label.tsx` + `inbox-row.tsx`（label+icon 走 catalog）
- Modify: `apps/mobile/app/(app)/[workspace]/search.tsx`（状态 label 走 useStatusLabel）

- [ ] **Step 1:** StatusIcon 扩 props；单测（custom color 覆盖、category glyph 映射）。
- [ ] **Step 2:** `lib/status-options.ts` + 单测（无自定义时与旧 7 态等价、hasCustom、archived 排除）。
- [ ] **Step 3:** CustomStatusChip + 测试（内置 null、自定义渲染、useIsCustomStatus 谓词）。
- [ ] **Step 4:** status-picker-body 改 catalog 分组（无自定义时渲染与现状一致的 7 行）。
- [ ] **Step 5:** issues-filter 状态区改 catalog。
- [ ] **Step 6:** board-view/list 列头 + 卡片 + 长按菜单 catalog 化；issue-row 加 chip（showStatus/相关面）。
- [ ] **Step 7:** 详情（attribute-row）/新建 / section header / table / inbox / search / activity 全走统一 label 解析。
- [ ] **Step 8:** 全量单测 + tsc + lint。
- [ ] **Step 9: Commit** `feat(mobile): catalog-aware status UI everywhere (MUL-6243)`

### Task 5: Settings 管理 tab + i18n

**Files:**
- Create: `apps/mobile/app/(app)/[workspace]/more/settings/issue-statuses.tsx`
- Modify: `apps/mobile/app/(app)/[workspace]/more/settings.tsx`（workspaces 区加入口行）
- Modify: `apps/mobile/lib/i18n/locales/en.json` / `zh.json`（`settings.statuses.*`）

**Interfaces:**
- Consumes: Task3 hooks、`canManageRole`（member-guards）+ memberListOptions 取当前角色 owner/admin、web COLOR_PICKER_PRESETS 同款 10 色
- Produces: `more/settings/issue-statuses` 路由；列表（内置锁定 + 自定义可编辑/归档/上下移）、新建（name/category/color/description）、编辑（name/desc/color，key/category 只读）、归档确认（Alert）、类别内上下移（reorder mutation）

- [ ] **Step 1:** en/zh 加 `settings.statuses.*` 键（title/description/show_archived/flag_off/loading/add/categories.*/built_in_locked/archived_badge/actions.*/archive_dialog.*/editor.*/reorder.*/moveUp/moveDown/empty）。parity 测试文件确认键集合一致。
- [ ] **Step 2:** 实现 settings 路由；settings.tsx workspaces 区新增 row（收藏图标 + goIssueStatuses）。
- [ ] **Step 3:** 单测：归档/编辑/新建 codec 相关纯函数（如 key 派生、表单校验）保持小；路由主体用 tsc 兜底。
- [ ] **Step 4:** 全量单测 + tsc + lint。
- [ ] **Step 5: Commit** `feat(mobile): issue statuses settings management tab (MUL-6243)`

### Task 6: 验证与交付

- [ ] `cd apps/mobile && npx tsc --noEmit`
- [ ] `npx vitest run`（全单测绿，含既有 ~975 项）
- [ ] `npx expo lint`
- [ ] 根目录 `pnpm --filter @multica/mobile` 等价构建脚本跑通
- [ ] `./android/gradlew -p android assembleRelease` 出 APK（记录产物名）
- [ ] 真机/模拟器联调 mu.zztweb.top：服务器未部署 catalog → 回退链路验证（内置 7 态全量渲染、board/list/filter/picker 无回归、截图）
- [ ] 结果评论 + issue 置 done