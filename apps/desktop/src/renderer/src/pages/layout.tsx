import { useState, useEffect } from 'react'
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@multica/ui/components/ui/button'
import { MulticaIcon } from '@multica/ui/components/multica-icon'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@multica/ui/components/ui/collapsible'
import {
  Home,
  MessageSquare,
  Users,
  Clock,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronsUpDown,
  Bot,
  LogOut,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@multica/ui/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@multica/ui/components/ui/sidebar'
import { cn } from '@multica/ui/lib/utils'
import { ModeToggle } from '../components/mode-toggle'
import { LocalChat } from '../components/local-chat'
import { DeviceConfirmDialog } from '../components/device-confirm-dialog'
import { UpdateNotification } from '../components/update-notification'
import { useAuthStore } from '../stores/auth'

const mainNavItems = [
  { path: '/', label: 'Home', icon: Home, exact: true },
  { path: '/chat', label: 'Chat', icon: MessageSquare },
]

const agentSubItems = [
  { path: '/agent/profile', label: 'Profile' },
  { path: '/agent/skills', label: 'Skills' },
  { path: '/agent/tools', label: 'Tools' },
]

const bottomNavItems = [
  { path: '/clients', label: 'Clients', icon: Users },
  { path: '/crons', label: 'Scheduled Tasks', icon: Clock },
]

// All nav items for header lookup
const allNavItems: Array<{ path: string; label: string; icon: typeof Home; exact?: boolean }> = [
  ...mainNavItems,
  { path: '/agent', label: 'Agent', icon: Bot },
  ...bottomNavItems,
]

function NavigationButtons() {
  const navigate = useNavigate()
  useLocation()

  const historyIdx = window.history.state?.idx ?? 0
  const canGoBack = historyIdx > 0
  const canGoForward = historyIdx < window.history.length - 1

  return (
    <div
      className="flex items-center gap-0.5 ml-auto mr-2"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => navigate(-1)}
        disabled={!canGoBack}
      >
        <ChevronLeft />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => navigate(1)}
        disabled={!canGoForward}
      >
        <ChevronRight />
      </Button>
    </div>
  )
}

function MainHeader() {
  const { state, isMobile } = useSidebar()
  const location = useLocation()
  const needsTrafficLightSpace = state === 'collapsed' || isMobile

  const currentPage = allNavItems.find((item) => {
    if (item.exact) return location.pathname === item.path
    return location.pathname.startsWith(item.path)
  })

  return (
    <header
      className="h-12 shrink-0 flex items-center px-4"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div
        className={cn(
          'h-full shrink-0 transition-[width] duration-200 ease-linear',
          needsTrafficLightSpace ? 'w-16' : 'w-0'
        )}
      />

      <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <SidebarTrigger
          className={cn(needsTrafficLightSpace && 'text-muted-foreground')}
        />
      </div>

      <div className="flex-1 flex justify-center">
        {currentPage && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <currentPage.icon className="size-4" />
            <span>{currentPage.label}</span>
          </div>
        )}
      </div>

      <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <ModeToggle />
      </div>
    </header>
  )
}

export default function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const isAgentActive = location.pathname.startsWith('/agent')
  const isOnChat = location.pathname === '/chat'
  const { user, clearAuth } = useAuthStore()

  // Lazy mount: only mount Chat on first visit, then keep it mounted forever
  const [chatMounted, setChatMounted] = useState(false)
  useEffect(() => {
    if (isOnChat && !chatMounted) setChatMounted(true)
  }, [isOnChat, chatMounted])

  // Extract initialPrompt from URL search params when navigating to /chat?prompt=...
  const initialPrompt = isOnChat
    ? new URLSearchParams(location.search).get('prompt') ?? undefined
    : undefined

  const handleLogout = async () => {
    await clearAuth()
    navigate('/login')
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <SidebarProvider className="flex-1 overflow-hidden">
        <Sidebar>
          <SidebarHeader
            className="h-12 shrink-0 flex items-center"
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
          >
            <NavigationButtons />
          </SidebarHeader>

          <SidebarContent>
            <div className="flex items-center gap-2 px-3 py-2">
              <MulticaIcon bordered noSpin />
              <span className="text-sm font-brand">Multica</span>
            </div>

            <SidebarGroup>
              <SidebarMenu className="space-y-0.5">
                {/* Main nav items */}
                {mainNavItems.map((item) => {
                  const isActive = item.exact
                    ? location.pathname === item.path
                    : location.pathname.startsWith(item.path)
                  return (
                    <SidebarMenuItem key={item.path}>
                      <NavLink to={item.path}>
                        <SidebarMenuButton isActive={isActive}>
                          <item.icon
                            className={cn(
                              'size-4 transition-colors',
                              !isActive && 'text-muted-foreground/50 group-hover/menu-button:text-foreground'
                            )}
                          />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </NavLink>
                    </SidebarMenuItem>
                  )
                })}

                {/* Agent collapsible */}
                <Collapsible defaultOpen className="group/collapsible">
                  <SidebarMenuItem>
                    <CollapsibleTrigger
                      render={<SidebarMenuButton isActive={isAgentActive} />}
                    >
                      <Bot
                        className={cn(
                          'size-4 transition-colors',
                          !isAgentActive && 'text-muted-foreground/50 group-hover/menu-button:text-foreground'
                        )}
                      />
                      <span>Agent</span>
                      <ChevronDown className="ml-auto size-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {agentSubItems.map((item) => (
                          <SidebarMenuSubItem key={item.path}>
                            <SidebarMenuSubButton
                              render={<NavLink to={item.path} />}
                              isActive={location.pathname === item.path}
                            >
                              {item.label}
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>

                {/* Bottom nav items */}
                {bottomNavItems.map((item) => {
                  const isActive = location.pathname.startsWith(item.path)
                  return (
                    <SidebarMenuItem key={item.path}>
                      <NavLink to={item.path}>
                        <SidebarMenuButton isActive={isActive}>
                          <item.icon
                            className={cn(
                              'size-4 transition-colors',
                              !isActive && 'text-muted-foreground/50 group-hover/menu-button:text-foreground'
                            )}
                          />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </NavLink>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<SidebarMenuButton size="lg" />}
                  >
                    <div className="size-8 rounded-lg bg-muted flex items-center justify-center text-sm font-medium">
                      {user?.name?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-medium">{user?.name || 'User'}</span>
                      <span className="truncate text-xs text-muted-foreground">{user?.email || ''}</span>
                    </div>
                    <ChevronsUpDown className="ml-auto size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="top" align="end">
                    <DropdownMenuItem variant="destructive" onClick={handleLogout}>
                      <LogOut className="size-4" />
                      Log out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset className="overflow-hidden">
          <MainHeader />
          <main className="flex-1 overflow-hidden min-h-1">
            <div className={cn('h-full', isOnChat && 'hidden')}>
              <Outlet />
            </div>
            {chatMounted && (
              <div className={cn('h-full flex flex-col overflow-hidden', !isOnChat && 'hidden')}>
                <LocalChat initialPrompt={initialPrompt} />
              </div>
            )}
          </main>
        </SidebarInset>

        <DeviceConfirmDialog />
        <UpdateNotification />
      </SidebarProvider>
    </div>
  )
}
