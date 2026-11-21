type Listener = () => void

let count = 0
const listeners = new Set<Listener>()

/**
 * How many answers are durable on this device but not yet acknowledged.
 * Written by whoever owns the flush (the run screen); read by the app
 * layout's offline banner so "Waiting to be sent: N" can show on any screen.
 */
export const pendingCountStore = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener)

    return () => {
      listeners.delete(listener)
    }
  },
  getSnapshot(): number {
    return count
  },
  set(next: number): void {
    const clamped = Math.max(0, Math.floor(next))

    if (clamped === count) {
      return
    }

    count = clamped

    for (const listener of [...listeners]) {
      listener()
    }
  },
}
