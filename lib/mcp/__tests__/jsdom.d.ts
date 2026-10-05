/**
 * The part of jsdom (a dev dependency without bundled types) that the view
 * render test (views.test.ts) uses, to avoid adding @types/jsdom.
 */
declare module 'jsdom' {
  export class VirtualConsole {
    on(event: 'jsdomError', listener: (error: Error) => void): this
    on(event: string, listener: (...args: unknown[]) => void): this
  }

  export interface ConstructorOptions {
    runScripts?: 'dangerously' | 'outside-only'
    virtualConsole?: VirtualConsole
    beforeParse?: (window: Window & typeof globalThis) => void
  }

  export class JSDOM {
    constructor(html?: string, options?: ConstructorOptions)
    readonly window: Window & typeof globalThis
  }
}
