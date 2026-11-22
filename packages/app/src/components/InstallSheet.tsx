import type { JSX, RefObject } from "react"
import { useTranslation } from "react-i18next"
import { BottomSheet } from "./BottomSheet.js"
import { Icon } from "./Icon.js"

export interface InstallSheetProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly kind: "ios" | "manual"
  readonly onConfirm: () => void
  readonly returnFocusRef?: RefObject<HTMLElement | null>
}

/** Prototype `case "install"` sheet. Android's native prompt is Chrome's own UI, so only iOS and manual steps live here. */
export function InstallSheet({
  open,
  onOpenChange,
  kind,
  onConfirm,
  returnFocusRef,
}: InstallSheetProps): JSX.Element {
  const { t } = useTranslation("runner")

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t(
        kind === "ios" ? "pwa.install.ios.title" : "pwa.install.manual.title",
      )}
      closeLabel={t("pwa.sheet.close")}
      returnFocusRef={returnFocusRef}
    >
      {kind === "ios" ? (
        <>
          <p className="reason">{t("pwa.install.ios.hint")}</p>
          <ol className="steps">
            <li>
              <span className="n">1</span>
              <span>
                {t("pwa.install.ios.step1")} <Icon name="share" small />
              </span>
            </li>
            <li>
              <span className="n">2</span>
              <span>
                {t("pwa.install.ios.step2")} <Icon name="plus" small />
              </span>
            </li>
            <li>
              <span className="n">3</span>
              <span>{t("pwa.install.ios.step3")}</span>
            </li>
          </ol>
          <div className="btnrow">
            <button type="button" className="btn" onClick={onConfirm}>
              {t("pwa.install.ios.done")}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                onOpenChange(false)
              }}
            >
              {t("pwa.install.close")}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="reason">{t("pwa.install.manual.body")}</p>
          <div className="btnrow">
            <button
              type="button"
              className="btn"
              onClick={() => {
                onOpenChange(false)
              }}
            >
              {t("pwa.install.close")}
            </button>
          </div>
        </>
      )}
    </BottomSheet>
  )
}
