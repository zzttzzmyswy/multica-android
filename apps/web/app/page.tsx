"use client"

import { AppSidebar } from "@multica/ui/components/app-sidebar"
import { SidebarInset, SidebarTrigger } from "@multica/ui/components/ui/sidebar"
import { Chat } from "./components/chat"

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
        <Chat />
      </SidebarInset>
    </>
  )
}
