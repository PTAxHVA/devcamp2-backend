import { describe, it, expect, afterEach, vi } from 'vitest'
import { env } from '../src/config/env.js'

describe('GEMINI_MODEL env config', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('defaults to gemini-2.5-flash when the env var is absent', () => {
    // vitest.config.ts env block deliberately does not set GEMINI_MODEL.
    expect(env.GEMINI_MODEL).toBe('gemini-2.5-flash')
  })

  it('honors an override from the environment', async () => {
    vi.stubEnv('GEMINI_MODEL', 'gemini-2.5-flash-lite')
    vi.resetModules()
    const fresh = await import('../src/config/env.js')
    expect(fresh.env.GEMINI_MODEL).toBe('gemini-2.5-flash-lite')
  })

  it('rejects an explicitly empty value', async () => {
    vi.stubEnv('GEMINI_MODEL', '')
    vi.resetModules()
    // env.ts exits the process on invalid env instead of throwing.
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called')
    }) as never)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(import('../src/config/env.js')).rejects.toThrow('process.exit called')
    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })
})
