/** Receipt files of the tests: the first bytes of each format, enough for the magic byte checks. */

export const text = (value: string) => new Uint8Array(Buffer.from(value, 'latin1'))

export const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1])
export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d])
export const PDF = text('%PDF-1.4 ticket de caisse')
export const HEIC = new Uint8Array([0, 0, 0, 0x18, ...Buffer.from('ftypheic'), 0, 0, 0, 0])

/** A JPEG whose content differs by `seed` (another sha256). */
export const jpegWith = (seed: string) => new Uint8Array([...JPEG, ...Buffer.from(seed)])
