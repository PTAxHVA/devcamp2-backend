import { describe, it, expect } from 'vitest'
import { hashPassword, comparePassword } from '../src/utils/password'

/**
 * Guards the bcrypt password hashing used by signup/login (auth.service).
 * Pure, DB-free, env-free (imports only bcrypt).
 */
describe('password hashing', () => {
  it('produces a bcrypt hash that is not the plaintext', async () => {
    const hash = await hashPassword('S3cret!pass')
    expect(hash).not.toBe('S3cret!pass')
    expect(hash.startsWith('$2')).toBe(true)
  })

  it('verifies a correct password against its hash', async () => {
    const hash = await hashPassword('S3cret!pass')
    expect(await comparePassword('S3cret!pass', hash)).toBe(true)
  })

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('S3cret!pass')
    expect(await comparePassword('wrong-password', hash)).toBe(false)
  })
})
