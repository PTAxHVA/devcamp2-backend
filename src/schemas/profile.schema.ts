import z from 'zod'
import { SkillLevel } from '../types/enums.js'

export const updateProfileSchema = z.object({
  username: z.string().optional(),
  level: z.nativeEnum(SkillLevel).optional(),
})

export const updateAccountCredentialsSchema = z.object({
  email: z.string().email().optional(),
  currentPassword: z.string().min(1, 'Current password is required'),
  password: z.string().min(8).optional(),
})

export const deactivateAccountSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
})

export type UpdateProfileSchema = z.infer<typeof updateProfileSchema>
export type UpdateAccountCredentialsSchema = z.infer<typeof updateAccountCredentialsSchema>
export type DeactivateAccountSchema = z.infer<typeof deactivateAccountSchema>
