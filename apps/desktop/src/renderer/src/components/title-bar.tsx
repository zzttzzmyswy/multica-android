export function TitleBar() {
  return (
    <div
      className="h-11 shrink-0 flex items-center border-b bg-sidebar select-none"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* Left: traffic light inset area (macOS) */}
      <div className="w-[78px] shrink-0" />

      {/* Center: reserved for future tabs */}
      <div className="flex-1 flex items-center px-2" />

      {/* Right: reserved for future window actions */}
      <div className="w-10 shrink-0" />
    </div>
  );
}
