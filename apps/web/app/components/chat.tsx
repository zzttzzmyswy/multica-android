import { SidebarTrigger } from "@multica/ui/components/ui/sidebar";

export function Chat() {
  return (
    <div className="h-dvh flex flex-col overflow-hidden">
      <header className="flex items-center p-2">
        <SidebarTrigger />
      </header>
      <main className="flex-1 overflow-y-auto min-h-0"></main>
    </div>
  );
}
