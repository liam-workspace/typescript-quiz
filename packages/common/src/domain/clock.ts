/**
 * Re-exported so no other package imports @liam-workspace/platform for a
 * clock. Service code takes a Clock; nothing calls new Date() or Date.now()
 * directly. Every deadline in this app is server-authoritative, and
 * createFixedClock is what turns an expiry test into an assertion rather
 * than a 50-minute sleep.
 */
export * from "@liam-workspace/platform"
