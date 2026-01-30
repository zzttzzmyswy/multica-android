"use client"

import { Markdown } from "@multica/ui/components/markdown"
import { ChatInput } from "@multica/ui/components/chat-input"
import { AppSidebar } from "@multica/ui/components/app-sidebar"
import { SidebarInset, SidebarTrigger } from "@multica/ui/components/ui/sidebar"

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

const NAV_ITEMS = [
  { title: "Home", url: "#" },
  { title: "Documents", url: "#" },
  { title: "Settings", url: "#" },
]

export default function Page() {
  return (
    <>
      <AppSidebar items={NAV_ITEMS} />
      <SidebarInset>
        <header className="flex h-12 items-center border-b px-4">
          <SidebarTrigger />
        </header>
        <div className="flex-1 p-8">
          <div className="max-w-2xl mx-auto">
            <Markdown mode="full">{MOCK_MD}</Markdown>
            <div className="mt-8">
              <ChatInput />
            </div>
          </div>
        </div>
      </SidebarInset>
    </>
  )
}
