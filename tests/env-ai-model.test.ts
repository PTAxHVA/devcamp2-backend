import { describe, it, expect, afterEach, vi } from 'vitest'
import { env } from '../src/config/env.js'

describe('FIREWORKS_MODEL env config', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('defaults to gpt-oss-120b when the env var is absent', () => {
    // vitest.config.ts env block deliberately does not set FIREWORKS_MODEL.
    expect(env.FIREWORKS_MODEL).toBe('accounts/fireworks/models/gpt-oss-120b')
  })

  it('honors an override from the environment', async () => {
    vi.stubEnv('FIREWORKS_MODEL', 'accounts/fireworks/models/gpt-oss-20b')
    vi.resetModules()
    const fresh = await import('../src/config/env.js')
    expect(fresh.env.FIREWORKS_MODEL).toBe('accounts/fireworks/models/gpt-oss-20b')
  })

  it('rejects an explicitly empty value', async () => {
    vi.stubEnv('FIREWORKS_MODEL', '')
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
