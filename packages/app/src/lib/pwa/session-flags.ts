/**
 * Keys in sessionStorage that outlive a page load but not the app's launch.
 * Every in-app navigation is a full page load, so module memory cannot carry
 * "already done this launch".
 */

/** Set once the cold-start splash has shown; cleared by an update. */
export const SPLASH_SHOWN_KEY = "pp.splashShown"

/** Set by `applyUpdate` just before the reload; read (and removed) once at boot. */
export const UPDATED_KEY = "pp.updated"

/** True once after an update reload: the boot that should say "Updated". */
export function takeUpdatedFlag(): boolean {
  try {
    const set = window.sessionStorage.getItem(UPDATED_KEY) === "1"

    window.sessionStorage.removeItem(UPDATED_KEY)

    return set
  } catch {
    return false
  }
}
