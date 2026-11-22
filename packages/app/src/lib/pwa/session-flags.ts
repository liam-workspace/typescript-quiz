/**
 * Keys in sessionStorage that outlive a page load but not the app's launch.
 * Every in-app navigation is a full page load, so module memory cannot carry
 * "already done this launch".
 */

/** Set once the cold-start splash has shown; cleared by an update. */
export const SPLASH_SHOWN_KEY = "pp.splashShown"
