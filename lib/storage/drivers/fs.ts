/**
 * Filesystem driver: a directory of the server (KLEDG_STORAGE_DIR), for a
 * single server or a Docker volume. Objects are written to a temporary file
 * then renamed (a reader never sees half a file), readable by the server's
 * user only (files 0600, directories 0700). The key is checked
 * (assertObjectKey) and the path must stay inside the directory.
 *
 * Not on Vercel or other serverless hosts: their filesystem is read-only or
 * lost at each deployment (refused in lib/storage/config.ts). Encryption at
 * rest is the disk's (LUKS, encrypted volume of the host).
 */

import { randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { assertObjectKey, type ObjectStorage } from '../types'

export function createFsStorage(root: string): ObjectStorage {
  const base = path.resolve(root)

  function fileOf(key: string): string {
    const file = path.resolve(base, assertObjectKey(key))
    if (!file.startsWith(base + path.sep)) throw new Error('Invalid object key')
    return file
  }

  const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'

  return {
    driver: 'fs',
    async put(key: string, body: Uint8Array) {
      const file = fileOf(key)
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
      const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`
      // flag wx: never overwrites (keys are random, a collision is a bug).
      await writeFile(temp, body, { mode: 0o600, flag: 'wx' })
      try {
        await stat(file).then(
          () => {
            throw new Error('Object already exists')
          },
          (error: unknown) => {
            if (!missing(error)) throw error
          },
        )
        await rename(temp, file)
      } catch (error) {
        await rm(temp, { force: true })
        throw error
      }
    },
    async get(key: string) {
      try {
        return new Uint8Array(await readFile(fileOf(key)))
      } catch (error) {
        if (missing(error)) return null
        throw error
      }
    },
    async getStream(key: string) {
      const file = fileOf(key)
      try {
        await stat(file)
      } catch (error) {
        if (missing(error)) return null
        throw error
      }
      return Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>
    },
    async delete(key: string) {
      await rm(fileOf(key), { force: true })
    },
    async exists(key: string) {
      try {
        return (await stat(fileOf(key))).isFile()
      } catch (error) {
        if (missing(error)) return false
        throw error
      }
    },
  }
}
