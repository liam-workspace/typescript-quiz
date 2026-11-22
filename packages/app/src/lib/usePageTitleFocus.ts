import { useEffect } from "react"

/**
 * Route changes are announced to assistive tech by moving focus to the new
 * page's `h1` (`data-page-title`, `tabIndex={-1}`). Pass the RESOLVED pathname
 * (loaders finished) so the title exists when the effect runs.
 */
export function usePageTitleFocus(pathname: string): void {
  useEffect(() => {
    document
      .querySelector<HTMLElement>("[data-page-title]")
      ?.focus({ preventScroll: true })
  }, [pathname])
}
