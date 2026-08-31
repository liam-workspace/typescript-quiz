import { useTranslation } from "react-i18next"

export interface OfflineBannerProps {
  readonly pendingCount: number
}

export function OfflineBanner({ pendingCount }: OfflineBannerProps) {
  const { t } = useTranslation("runner")

  return (
    <section
      data-testid="offline-banner"
      role="alert"
      aria-label={t("runner.offline.title")}
      className="offline-notice mb-4 rounded-[9px] border border-[#efd9ac] bg-[#fcf4e4] px-3.5 py-2.5 text-[13.5px] font-semibold text-[#7a5a18]"
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
      <p className="mt-2 text-sm font-bold">
        {t("runner.saveState.pending", { count: pendingCount })}
      </p>
    </section>
  )
}
