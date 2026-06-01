import z from 'zod'
import { SkillLevel } from '../types/enums.js'

export const updateProfileSchema = z.object({
  userId: z.string(),
  username: z.string().optional(),
  level: z.enum(Object.values(SkillLevel)).optional(),
})

export const updateAccountCredentialsSchema = z.object({
  userId: z.string(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
})

export type UpdateProfileSchema = z.infer<typeof updateProfileSchema>
export type UpdateAccountCredentialsSchema = z.infer<typeof updateAccountCredentialsSchema>
