# 移动端「通过智能体创建」设计(MYS-373 / 迭代 56)

> 对齐目标:web `packages/views/modals/quick-create-issue.tsx`(AgentCreatePanel)+ `POST /api/issues/quick-create`。
> 需求来源:backlog issue MYS-373「新建任务支持『通过智能体创建』」。

## 一、需求与现状

- **需求**:移动端新建任务不一定要手写标题;用户以自然语言描述任务,交由 agent 处理,agent 生成标题/描述并创建/执行 issue。手写表单路径保留。
- **现状**:移动端 `new-issue.tsx` 仅手动表单(标题 → 描述 → 属性),`api.ts` 无 quick-create 方法。

## 二、Web 参照机制(事实)

web 端 quick-create(AgentCreatePanel):
- 输入自然语言 prompt(富文本编辑器,支持附件)
- 选择 actor:agent 或 squad(默认:上次成功选择 → 第一个可见 agent)
- 可选:项目 / 优先级 / 截止日期
- 提交 → `POST /api/issues/quick-create` body `{agent_id | squad_id, prompt, project_id?, priority?, due_date?, parent_issue_id?, attachment_ids?}` → `{task_id}`
- 成功后该任务进入 agent 执行通道,不要求用户写标题;issue 由 agent 生成
- 入口:底部「New task」快捷对话框初始即为 agent 模式;完整 create-issue 对话框可 manual ↔ agent 切换

## 三、移动端方案

**落点**:`new-issue.tsx` 顶部加模式分段控件「手动填写 | 通过智能体创建」,单页双模式(对齐 web 的 mode 切换)。不改动现有入口(HeaderActions + button)。

### 组件与数据流

1. **`data/api.ts` 新增 `quickCreateIssue(body)`** → `POST /api/issues/quick-create` → `{task_id}`。body 类型本地内联(与 web client.ts 对齐)。
2. **`new-issue-draft-store.ts` 新增 `agentActor: ActorValue | null`**(type = `{type: "agent"|"squad"; id: string}`)+ setter + reset 纳入。actor 跨 picker route 通信用(与 assignee 同模式)。
3. **`new-issue.tsx`**:
   - mode 本地 state(`"manual" | "agent"`,初始 manual)
   - 两种模式输入状态全部保留在父组件(title/description 现状;prompt 新本地 state),切换只换渲染子树
   - headerRight SubmitIssueButton 条件:manual = title 非空;agent = prompt 非空 & actor 已选;loading 状态区分
4. **`components/issue/quick-create-panel.tsx`(新)**:
   - prompt 多行 TextInput(placeholder 引导自然语言描述)
   - actor chip(头像+名字)→ push `new-issue-picker/agent`
   - 属性行:复用 `CreateFormAttributeRow`,加可选 `fields` prop 过滤(agent 模式只显示 project/priority/due-date)
   - 提交:`api.quickCreateIssue`,成功 Alert「任务已创建并交给 {actor} 处理」→ `router.back()`;失败 Alert 可读错误
5. **`new-issue-picker/agent.tsx`(新 route)**:复用 `AssigneePickerBody`,加可选 `kinds` prop(agent 模式传 `["agent","squad"]` 过滤成员)。route 读写 draft store `agentActor`。
6. **`_layout.tsx`**:注册 `new-issue-picker/agent` Stack.Screen(与既有 picker 同形态)。

### 状态不回归保证

- manual/agent 各自输入互不清空(mode 是同一屏幕内 state)
- draft store 的 project/priority/dueDate 为两模式共享(与 web 共享 draft 语义一致)
- assignee/status 仅 manual 使用,agent 模式不读(actor 独立字段)

### 与 web 的合理简化(记录,后续可增强)

- 不做 runtime CLI 版本检查(移动端无此链路;服务端仍做信任边界校验)
- agent 模式第一版不带附件上传(prompt 为纯文本输入)
- actor 默认记忆不做持久化:每次打开默认第一个可见 agent(有 actor 已选则保留)

## 四、i18n 新增键(en/zh 对齐)

`newIssue.modeManual` / `newIssue.modeAgent` / `newIssue.agentPlaceholder` / `newIssue.agentSelectAgent` / `newIssue.agentSentTitle` / `newIssue.agentSentBody` / `attr.agent` / `a11y.newIssueAgentPicker`。

## 五、验收

- [ ] 新任务页出现「手动填写 | 通过智能体创建」切换,两模式状态互不丢失
- [ ] agent 模式:prompt 输入 + agent/squad 选择(默认第一个)+ 项目/优先级/截止日期可选
- [ ] 提交 → POST /api/issues/quick-create → 成功提示 + 返回;失败可读提示
- [ ] 手写路径无回归;assignee picker 加 kinds 过滤不破坏现有调用
- [ ] tsc/vitest/lint 全通过;assembleDebug 出 APK;模拟器实测截图
- [ ] 完成后 MYS-373 追加「已实现」评论并置 done;迭代 56 issue 置 done

## 六、TDD 测试

- `data/api-quickcreate.test.ts`:mock fetch 验证端点 `/api/issues/quick-create`、POST body(agent_id/prompt/可选字段透传)、返回 `{task_id}` 解析
- 纯逻辑(如 actor 默认选择)抽出小函数并有 props 化测试(如有必要)