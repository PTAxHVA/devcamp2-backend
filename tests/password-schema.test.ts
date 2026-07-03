import { describe, it, expect } from 'vitest'
import { loginSchema, signupSchema } from '../src/schemas/auth.schema.js'
import { resetPasswordSchema } from '../src/schemas/password-reset.schema.js'

/**
 * M6 — signup + reset must ENFORCE the same 5 rules the FE checklist shows, so the
 * UI can't imply rules the API skips. Login stays min(8) so existing accounts with
 * weaker passwords are never locked out.
 */
const signup = (password: string) =>
  signupSchema.safeParse({ email: 'a@b.com', password, username: 'Alice' }).success

const reset = (newPassword: string) =>
  resetPasswordSchema.safeParse({ token: 't', newPassword }).success

describe('signup strong-password rules (M6)', () => {
  it('accepts a password meeting all 5 rules', () => {
    expect(signup('Password123!')).toBe(true)
  })

  it('rejects too short / no uppercase / no lowercase / no number / no special', () => {
    expect(signup('Ab1!xy')).toBe(false) // < 8
    expect(signup('password123!')).toBe(false) // no uppercase
    expect(signup('PASSWORD123!')).toBe(false) // no lowercase
    expect(signup('Password!!!')).toBe(false) // no number
    expect(signup('Password123')).toBe(false) // no special
    expect(signup('aaaaaaaa')).toBe(false) // the QA-reported weak password
  })
})

describe('reset-password strong-password rules (M6)', () => {
  it('mirrors the signup rules', () => {
    expect(reset('Password123!')).toBe(true)
    expect(reset('aaaaaaaa')).toBe(false)
    expect(reset('Password123')).toBe(false)
  })
})

describe('login stays min(8) (M6 — no lockout)', () => {
  it('accepts a weak-but-8-char password and rejects shorter', () => {
    expect(loginSchema.safeParse({ email: 'a@b.com', password: 'aaaaaaaa' }).success).toBe(true)
    expect(loginSchema.safeParse({ email: 'a@b.com', password: 'short' }).success).toBe(false)
  })
})
