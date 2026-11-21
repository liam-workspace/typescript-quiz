/**
 * One-shot generator for the installable-app icons. Output is committed
 * under packages/app/public; re-run only when the mark changes:
 *   pnpm icons:pwa
 *
 * Mark = the prototype's logo (docs/prototype/pwa-mobile.html `.logo`):
 * a white "P" on the app's teal. Maskable and Apple icons are full-bleed
 * (the OS rounds them) with the glyph inside the maskable safe zone.
 */
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const outDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../packages/app/public",
)
const TEAL = "#0f6e78"
const GLYPH =
  "M176 120h112c58 0 98 38 98 92s-40 92-98 92h-48v88h-64V120zm64 56v72h44c24 0 40-14 40-36s-16-36-40-36h-44z"
const NS = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"'
const glyph = `<path transform="translate(-24 0)" fill="#fff" fill-rule="evenodd" d="${GLYPH}"/>`

const rounded = `<svg ${NS}><rect width="512" height="512" rx="112" fill="${TEAL}"/>${glyph}</svg>`

function fullBleed(scale: number): string {
  return `<svg ${NS}><rect width="512" height="512" fill="${TEAL}"/><g transform="translate(256 256) scale(${String(scale)}) translate(-256 -256)">${glyph}</g></svg>`
}

async function png(svg: string, size: number, file: string): Promise<void> {
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(resolve(outDir, file))
}

await mkdir(outDir, { recursive: true })
await writeFile(resolve(outDir, "icon.svg"), rounded)
await png(rounded, 192, "pwa-192x192.png")
await png(rounded, 512, "pwa-512x512.png")
await png(fullBleed(0.7), 512, "pwa-maskable-512x512.png")
await png(fullBleed(0.82), 180, "apple-touch-icon-180x180.png")
