import type { ReminderLocale } from "@pp/db"
import type { PushMessage } from "./push-sender.js"

/**
 * The only text the server ever pushes. Fixed strings per locale: no name, no
 * score, no test title -- a lock screen is not private.
 */
const BODIES: Record<ReminderLocale, string> = {
  de: "Zeit für ein bisschen Übung 🎧",
  en: "Time for a little practice 🎧",
  es: "Hora de practicar un poquito 🎧",
  fr: "C'est l'heure de s'entraîner un peu 🎧",
  it: "È ora di fare un po' di pratica 🎧",
  ja: "ちょっと練習する時間だよ 🎧",
}

/** The product name, as in the app's `<title>`; not translated. */
const TITLE = "Primary Practice"

export function reminderMessage(locale: ReminderLocale): PushMessage {
  return { title: TITLE, body: BODIES[locale], url: "/" }
}
