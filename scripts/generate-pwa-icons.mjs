#!/usr/bin/env node
/**
 * Generates the PNG icons of the web app manifest (app/manifest.ts) and the
 * Apple touch icon from the monochrome K mark (public/logo.svg). The outputs
 * are committed: run this again only when the mark changes.
 *
 *   node scripts/generate-pwa-icons.mjs
 *
 * sharp is not a dependency of Kledg: Next.js already installs it (image
 * optimization), so it is loaded from Next's own dependencies instead of
 * adding a package for a script that runs once.
 *
 * - public/icons/icon-192.png, icon-512.png: the logo as on the website
 *   (rounded ink square), transparent corners, purpose "any".
 * - public/icons/maskable-512.png: full-bleed ink square, the K kept inside
 *   the 80% safe zone so Android masks (circle, squircle) never cut it.
 * - app/apple-icon.png (180): full-bleed square, iOS rounds the corners
 *   itself and renders transparency as black. Next.js links it as
 *   apple-touch-icon (metadata file convention).
 */

import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const requireFromNext = createRequire(createRequire(import.meta.url).resolve('next'))
let sharp
try {
  sharp = requireFromNext('sharp')
} catch {
  console.error('sharp is not installed with next: run `pnpm add -D sharp` and try again.')
  process.exit(1)
}

const INK = '#0a0a0a'
// The three paths of the K, in the 32x32 box of public/logo.svg.
const logo = await readFile(path.join(root, 'public/logo.svg'), 'utf8')
const glyph = /<g fill="#fff">([\s\S]*?)<\/g>/.exec(logo)?.[1]
if (!glyph) throw new Error('public/logo.svg: the K paths were not found')

/** A square icon: `radius` 7 is the logo, 0 a full-bleed square; `scale` shrinks the K around the center. */
const svg = ({ radius, scale }) => {
  const offset = 16 * (1 - scale)
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
      `<rect width="32" height="32" rx="${radius}" fill="${INK}"/>` +
      `<g fill="#fff" transform="translate(${offset} ${offset}) scale(${scale})">${glyph}</g>` +
      `</svg>`,
  )
}

const outputs = [
  { file: 'public/icons/icon-192.png', size: 192, radius: 7, scale: 1 },
  { file: 'public/icons/icon-512.png', size: 512, radius: 7, scale: 1 },
  { file: 'public/icons/maskable-512.png', size: 512, radius: 0, scale: 0.8 },
  { file: 'app/apple-icon.png', size: 180, radius: 0, scale: 0.9 },
]

await mkdir(path.join(root, 'public/icons'), { recursive: true })
for (const { file, size, radius, scale } of outputs) {
  await sharp(svg({ radius, scale }), { density: 72 * (size / 32) })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(path.join(root, file))
  console.log(`${file} (${size}x${size})`)
}
