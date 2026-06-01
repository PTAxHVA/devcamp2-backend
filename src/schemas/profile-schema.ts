import z from 'zod'
import { SkillLevel } from '../types/enums.js'

export const updateProfileSchema = z.object({
  userId: z.string(),
  username: z.string().optional(),
  level: z.enum(Object.values(SkillLevel)).optional(),
})

export type UpdateProfileSchema = z.infer<typeof updateProfileSchema>
