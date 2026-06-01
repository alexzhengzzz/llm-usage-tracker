import * as React from "react"
import { cn } from "@/lib/utils"

const ScrollArea = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("relative overflow-hidden", className)}
    {...props}
  >
    <div className="h-full w-full overflow-y-auto overflow-x-hidden" style={{ scrollbarWidth: 'thin' }}>
      {props.children}
    </div>
    <div className="pointer-events-none absolute inset-y-0 right-0 w-px bg-border" />
  </div>
))
ScrollArea.displayName = "ScrollArea"

export { ScrollArea }
