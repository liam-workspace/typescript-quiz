import type { JSX } from "react"
import { useTranslation } from "react-i18next"

const BRAND_INITIAL = "P"

export interface SplashProps {
  readonly visible: boolean
}

/** Prototype `#splash`: teal, white logo, brand. Fades out via `data-visible`. */
export function Splash({ visible }: SplashProps): JSX.Element {
  const { t } = useTranslation("runner")

  return (
    <div className="splash" data-visible={visible} aria-hidden="true">
      <div className="logo">{BRAND_INITIAL}</div>
      <b>{t("library.brand")}</b>
    </div>
  )
}
