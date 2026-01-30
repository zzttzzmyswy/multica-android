"use client"

import { Markdown } from "@multica/ui/components/markdown"

const MOCK_MD = `# Markdown 渲染器示例

这是一个 **Markdown** 渲染组件的演示页面，支持多种常见语法。

## 代码高亮

\`\`\`typescript
interface User {
  id: string
  name: string
  email: string
}

async function fetchUser(id: string): Promise<User> {
  const res = await fetch(\`/api/users/\${id}\`)
  return res.json()
}
\`\`\`

## 列表

- React 组件化架构
- Shiki 语法高亮
- GFM 表格和任务列表支持

## 表格

| 功能 | 状态 | 说明 |
|------|------|------|
| 代码高亮 | ✅ | 基于 Shiki |
| GFM 表格 | ✅ | remark-gfm |
| 流式渲染 | ✅ | StreamingMarkdown |

## 引用

> 好的设计是尽可能少的设计。
> — Dieter Rams

行内代码示例：使用 \`cn()\` 工具函数合并 class。

这是一个 [链接示例](https://github.com)。
`

export default function Page() {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-8">
      <div className="max-w-2xl w-full">
        <Markdown mode="full">{MOCK_MD}</Markdown>
      </div>
    </div>
  )
}
