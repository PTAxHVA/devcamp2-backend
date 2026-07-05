import z from 'zod'
import { SkillLevel } from '../types/enums.js'
import { strongPassword } from './auth.schema.js'

export const updateProfileSchema = z.object({
  username: z.string().optional(),
  level: z.nativeEnum(SkillLevel).optional(),
})

export const updateAccountCredentialsSchema = z.object({
  email: z.string().email().optional(),
  currentPassword: z.string().min(1, 'Current password is required'),
  // Same strong policy as signup/reset so an authenticated change can't downgrade
  // to a weak password (login stays min(8) for legacy accounts).
  password: strongPassword.optional(),
})

export const deactivateAccountSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
})

// Verified Skill Passport visibility. `regenerate` mints a fresh share token
// (old link stops working) and only makes sense while turning/keeping it public.
export const updatePassportSchema = z.object({
  isPublic: z.boolean(),
  regenerate: z.boolean().optional(),
})

export type UpdateProfileSchema = z.infer<typeof updateProfileSchema>
export type UpdateAccountCredentialsSchema = z.infer<typeof updateAccountCredentialsSchema>
export type DeactivateAccountSchema = z.infer<typeof deactivateAccountSchema>
export type UpdatePassportSchema = z.infer<typeof updatePassportSchema>
