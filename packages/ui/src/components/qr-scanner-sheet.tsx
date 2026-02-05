"use client"

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@multica/ui/components/ui/sheet"
import { QrScannerView } from "@multica/ui/components/qr-scanner-view"

export interface QrScannerSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onResult: (data: string) => Promise<void>
}

export function QrScannerSheet({
  open,
  onOpenChange,
  onResult,
}: QrScannerSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="px-4 pb-8">
        {/* Drag handle */}
        <div className="mx-auto mt-2 mb-1 h-1 w-10 rounded-full bg-muted-foreground/30" />
        <SheetHeader>
          <SheetTitle className="text-center">Scan Connection Code</SheetTitle>
        </SheetHeader>
        <div className="mt-4">
          <QrScannerView
            open={open}
            onResult={onResult}
            onClose={() => onOpenChange(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
