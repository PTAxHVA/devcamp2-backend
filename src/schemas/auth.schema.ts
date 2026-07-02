import { z } from 'zod'

// Strong password used for signup + reset (mirrors the FE 5-rule checklist so the
// UI can't imply rules the API doesn't enforce). Login stays min(8) so existing
// accounts with weaker passwords are never locked out.
export const strongPassword = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must include an uppercase letter')
  .regex(/[a-z]/, 'Password must include a lowercase letter')
  .regex(/[0-9]/, 'Password must include a number')
  .regex(/[^A-Za-z0-9]/, 'Password must include a special character')

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
})

export const signupSchema = z.object({
  email: z.email(),
  password: strongPassword,
  username: z.string().min(2).max(50).trim(),
})

export type LoginInput = z.infer<typeof loginSchema>
export type SignupInput = z.infer<typeof signupSchema>
