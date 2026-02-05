import { cn } from "@multica/ui/lib/utils"

function Loading({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span className={cn("spinner text-muted-foreground", className)} {...props}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className="spinner-cube" />
      ))}
    </span>
  )
}

export { Loading }
