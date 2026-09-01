import { Dialog } from "radix-ui"
import type { JSX, ReactNode, RefObject } from "react"

export interface DeviceSheetProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly side: "left" | "right"
  readonly closeLabel: string
  readonly className: string
  readonly children: ReactNode
  readonly ariaDescribedBy?: string
  readonly returnFocusRef?: RefObject<HTMLElement | null>
  readonly suppressReturnFocusRef?: RefObject<boolean>
}

/**
 * The product sheets are modal interaction boundaries: Radix supplies the
 * focus scope, Escape handling, outside-content aria hiding, and pointer
 * lock. The local content wrapper exists because the UI kit's SheetContent
 * hard-codes an English close label and cannot apply device safe areas.
 */
export function DeviceSheet({
  open,
  onOpenChange,
  side,
  closeLabel,
  className,
  children,
  ariaDescribedBy,
  returnFocusRef,
  suppressReturnFocusRef,
}: DeviceSheetProps): JSX.Element {
  return (
    <Dialog.Root modal open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="device-sheet-overlay fixed inset-0 z-[60] bg-black/50" />
        <Dialog.Content
          aria-describedby={ariaDescribedBy}
          onCloseAutoFocus={(event) => {
            if (!returnFocusRef) {
              return
            }

            event.preventDefault()

            if (suppressReturnFocusRef?.current) {
              suppressReturnFocusRef.current = false
              return
            }

            returnFocusRef.current?.focus()
          }}
          data-side={side}
          className={`device-sheet-content fixed inset-y-0 z-[70] flex h-[100dvh] flex-col ${
            side === "left" ? "left-0" : "right-0"
          } ${className}`}
        >
          {children}
          <Dialog.Close
            type="button"
            aria-label={closeLabel}
            className="device-sheet-close absolute grid size-11 place-items-center rounded-md text-2xl leading-none opacity-70 hover:opacity-100"
          >
            <span aria-hidden="true">×</span>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
