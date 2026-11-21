import { useId, type JSX, type Ref } from "react"
import { useTranslation } from "react-i18next"
import { Icon } from "./Icon.js"

export interface OfflineBannerProps {
  readonly variant: "browsing" | "in-test"
  readonly pendingCount: number
}

/** Prototype `banners()` → `.banner.off`. */
export function OfflineBanner({
  variant,
  pendingCount,
}: OfflineBannerProps): JSX.Element {
  const { t } = useTranslation("runner")

  return (
    <div
      className="banner off"
      role="status"
      data-testid="offline-banner"
      data-variant={variant}
    >
      <Icon name="wifioff" />
      <span>
        {t(
          variant === "in-test" ? "pwa.offline.inTest" : "pwa.offline.browsing",
        )}
        {pendingCount > 0 ? (
          <>
            {" "}
            <b>{t("pwa.offline.waiting", { count: pendingCount })}</b>
          </>
        ) : null}
      </span>
    </div>
  )
}

export interface UpdateBannerProps {
  readonly deferred: boolean
  readonly onRefresh: () => void
}

/** Prototype `banners()` → `.banner.upd`; `deferred` is the in-test wording with no button. */
export function UpdateBanner({
  deferred,
  onRefresh,
}: UpdateBannerProps): JSX.Element {
  const { t } = useTranslation("runner")

  if (deferred) {
    return (
      <div className="banner upd" role="status">
        <Icon name="refresh" />
        <span>{t("pwa.update.deferred")}</span>
      </div>
    )
  }

  return (
    <div className="banner upd" role="status">
      <Icon name="refresh" />
      <span className="grow">{t("pwa.update.ready")}</span>
      <button type="button" className="btn sm" onClick={onRefresh}>
        {t("pwa.update.refresh")}
      </button>
    </div>
  )
}

export interface InstallCardProps {
  readonly onInstall: () => void
  readonly onDismiss: () => void
  /** Lets the host return focus to Install when its sheet closes. */
  readonly installRef?: Ref<HTMLButtonElement>
}

/** Prototype `vLibrary()` → `section.card.install`. */
export function InstallCard({
  onInstall,
  onDismiss,
  installRef,
}: InstallCardProps): JSX.Element {
  const { t } = useTranslation("runner")
  const headingId = useId()

  return (
    <section className="card install" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-base font-extrabold">
        {t("pwa.install.title")}
      </h2>
      <p>{t("pwa.install.body")}</p>
      <div className="actions">
        <button
          ref={installRef}
          type="button"
          className="btn sm"
          onClick={onInstall}
        >
          <Icon name="plus" small /> {t("pwa.install.button")}
        </button>
        <button type="button" className="btn sm ghost" onClick={onDismiss}>
          {t("pwa.install.notNow")}
        </button>
      </div>
    </section>
  )
}
