import { useTranslation } from "react-i18next"

export interface PendingSyncNoteProps {
  readonly pendingAttempts: number
  readonly failed: boolean
}

export function PendingSyncNote({
  pendingAttempts,
  failed,
}: PendingSyncNoteProps) {
  const { t } = useTranslation("runner")

  if (failed) {
    return (
      <p role="alert" className="m-alert mt-3">
        {t("offline.syncFailed")}
      </p>
    )
  }

  if (pendingAttempts === 0) {
    return null
  }

  return (
    <p role="status" className="m-notice">
      {t("offline.pendingSync")}
    </p>
  )
}
