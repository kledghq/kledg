import { randomBytes } from 'crypto'

/**
 * Collision-resistant ids shaped like Prisma's cuid() (25 characters,
 * starting with "c"), generated in the application so bulk imports (FEC
 * import, seed scripts) can insert related rows with createMany instead of
 * one round trip per row.
 */

const BASE = 36
let counter = Math.floor(Math.random() * BASE ** 4)
const fingerprint = randomBytes(4).readUInt32BE(0).toString(BASE).padStart(4, '0').slice(-4)

function randomBlock(): string {
  return randomBytes(6).readUIntBE(0, 6).toString(BASE).padStart(8, '0').slice(-8)
}

export function createId(): string {
  counter = (counter + 1) % BASE ** 4
  const time = Date.now().toString(BASE).padStart(8, '0').slice(-8)
  return `c${time}${counter.toString(BASE).padStart(4, '0')}${fingerprint}${randomBlock()}`
}
