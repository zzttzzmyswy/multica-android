# Desktop 登录集成

## 登录流程

```
Desktop 点击登录
    ↓
启动本地 HTTP 服务器 (随机端口，如 54321)
    ↓
打开浏览器 → http://localhost:3000/api/desktop/session?port=54321&platform=web
    ↓
Web 重定向 → /login?next=...
    ↓
用户登录，调用 /api/v1/auth/login (代理到 api-dev.copilothub.ai)
    ↓
登录成功，回调 → http://127.0.0.1:54321/callback?sid=xxx&user=xxx
    ↓
Desktop 保存到 ~/.super-multica/auth.json
```

## 前端逻辑

### Web 端

- 端口：**3000**
- 登录 API：`/api/v1/auth/login`（通过 Next.js rewrites 代理到后端）
- 登录成功后回调：`http://127.0.0.1:{port}/callback?sid=xxx&user=xxx`

### Desktop 端

- 点击登录 → 启动本地服务器 → 打开浏览器
- 收到回调 → 保存到本地文件

## 存储

**路径：** `~/.super-multica/auth.json`

Desktop 登录成功后，SID 和用户信息存储在本地文件：

```json
{
  "sid": "session-id-from-backend",
  "user": {
    "uid": "user-id",
    "name": "User Name",
    "email": "user@example.com"
  }
}
```

后续请求可从此文件读取 `sid` 进行认证。

## 退出登录

**后端只需要返回错误，前端会自动处理退出。**

前端收到认证错误后：
1. 调用 `auth:clear` 清除本地数据
2. 跳转到登录页

## 本地调试

```bash
# 1. 启动 Web（Next.js rewrites 自动代理 /api/* 到 api-dev.copilothub.ai）
pnpm dev:web

# 2. 启动 Desktop
pnpm dev:desktop
```

本地调试时，Next.js rewrites（配置在 `apps/web/next.config.ts`）自动将 `/api/*` 请求代理到 `MULTICA_API_URL` 指定的后端。

## 参考

- **Cap** - https://github.com/CapSoftware/Cap
