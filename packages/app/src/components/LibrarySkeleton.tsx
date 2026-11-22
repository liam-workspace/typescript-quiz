import { useTranslation } from "react-i18next"

export function LibrarySkeleton() {
  const { t } = useTranslation("runner")

  return (
    <div role="status" aria-busy="true" className="m-stack">
      <span className="sr-only">{t("library.skeletonLabel")}</span>
      <div className="m-skeleton" />
      <div className="m-skeleton" />
      <div className="m-skeleton" />
    </div>
  )
}
