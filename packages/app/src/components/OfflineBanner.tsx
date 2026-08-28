import { useTranslation } from "react-i18next"

export interface OfflineBannerProps {
  readonly pendingCount: number
}

export function OfflineBanner({ pendingCount }: OfflineBannerProps) {
  const { t } = useTranslation("runner")

  return (
    <section
      data-testid="offline-banner"
      aria-label={t("runner.offline.title")}
      className="border-amber bg-surface text-ink rounded-device mx-3 mt-3 border p-4"
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="text-amber text-lg">
          📶
        </span>
        <div className="min-w-0">
          <p className="font-bold">{t("runner.offline.title")}</p>
          <p className="text-ink-2 mt-1 text-sm leading-6">
            {t("runner.offline.message")}
          </p>
        </div>
      </div>
      <div className="border-line bg-paper text-ink-2 mt-3 rounded-md border px-3 py-2 text-sm font-semibold">
        {t("runner.saveState.pending", { count: pendingCount })}
      </div>
    </section>
  )
}
