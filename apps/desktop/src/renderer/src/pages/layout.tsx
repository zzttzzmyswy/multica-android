import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { Toaster } from '@multica/ui/components/ui/sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Home01Icon,
  Comment01Icon,
  CodeIcon,
  PlugIcon,
  Share08Icon,
  Time04Icon,
} from '@hugeicons/core-free-icons'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@multica/ui/components/ui/sidebar'
import { cn } from '@multica/ui/lib/utils'
import { ModeToggle } from '../components/mode-toggle'
import { DeviceConfirmDialog } from '../components/device-confirm-dialog'

const navItems = [
  { path: '/', label: 'Home', icon: Home01Icon },
  { path: '/chat', label: 'Chat', icon: Comment01Icon },
  { path: '/tools', label: 'Tools', icon: CodeIcon },
  { path: '/skills', label: 'Skills', icon: PlugIcon },
  { path: '/channels', label: 'Channels', icon: Share08Icon },
  { path: '/crons', label: 'Crons', icon: Time04Icon },
]

function MainHeader() {
  const { state, isMobile } = useSidebar()
  const needsTrafficLightSpace = state === 'collapsed' || isMobile

  return (
    <header className="h-12 shrink-0 flex items-center px-4">
      {/* Drag placeholder for traffic lights when sidebar is collapsed */}
      <div
        className={cn(
          'h-full shrink-0 transition-[width] duration-200 ease-linear',
          needsTrafficLightSpace ? 'w-16' : 'w-0'
        )}
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      <SidebarTrigger />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right: Theme toggle */}
      <ModeToggle />
    </header>
  )
}

export default function Layout() {
  const location = useLocation()

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <SidebarProvider className="flex-1 overflow-hidden">
        <Sidebar>
        {/* Traffic light area */}
        <SidebarHeader
          className="h-12 shrink-0"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        />

        <SidebarContent>
          <SidebarGroup>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = item.path === '/'
                  ? location.pathname === '/'
                  : location.pathname.startsWith(item.path)
                return (
                  <SidebarMenuItem key={item.path}>
                    <NavLink to={item.path}>
                      <SidebarMenuButton isActive={isActive}>
                        <HugeiconsIcon icon={item.icon} className="size-4" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </NavLink>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <SidebarInset className="overflow-hidden">
        <MainHeader />

        {/* Main Content */}
        <main className="flex-1 overflow-hidden min-h-1">
          <Outlet />
        </main>
      </SidebarInset>

        <Toaster />
        <DeviceConfirmDialog />
      </SidebarProvider>
    </div>
  )
}
