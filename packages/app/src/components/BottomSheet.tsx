import { Dialog } from "radix-ui"
import type { JSX, ReactNode, RefObject } from "react"
import { Icon } from "./Icon.js"

export interface BottomSheetProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly title: string
  readonly closeLabel: string
  readonly returnFocusRef?: RefObject<HTMLElement | null>
  readonly children: ReactNode
}

/**
 * The prototype's `openSheet()` as a Radix dialog: modal focus scope, Escape,
 * outside content hidden from assistive tech, and focus returned to the
 * trigger. The title names the dialog; there is no description, so
 * `aria-describedby` is explicitly undefined (otherwise Radix warns).
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  closeLabel,
  returnFocusRef,
  children,
}: BottomSheetProps): JSX.Element {
  return (
    <Dialog.Root modal open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="bsheet-overlay" />
        <Dialog.Content
          className="bsheet"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            if (!returnFocusRef?.current) {
              return
            }

            event.preventDefault()
            returnFocusRef.current.focus()
          }}
        >
          <div className="bsheet-grab" aria-hidden="true" />
          <div className="bsheet-head">
            <Dialog.Title className="bsheet-title">{title}</Dialog.Title>
            <Dialog.Close
              type="button"
              className="iconbtn"
              aria-label={closeLabel}
            >
              <Icon name="x" />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
