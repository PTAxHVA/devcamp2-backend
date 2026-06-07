import { z } from 'zod'
import { objectId } from './object-id.schema.js'

/**
 * Onboarding questionnaire body (F2 + F3). Canonical field names match the
 * OnboardingQuestionnaire model and the ai-suggest consumer. role + goal are
 * required (M3A 3-step minimum); the rest are optional so a partial M3A submit
 * and the full week-3 submit both work through the same upsert endpoint.
 */
export const submitOnboardingSchema = z.object({
  rolePreference: z.string().min(1, 'rolePreference is required').max(50),
  goal: z.string().min(1, 'goal is required').max(200),
  currentComfortLevel: z.string().max(50).optional(),
  timePerWeekHours: z.number().int().min(0).max(168).optional(),
  learningStyle: z.string().max(50).optional(),
  frameworkPreference: z.string().max(50).optional(),
  projectType: z.string().max(200).optional(),
  cliComfort: z.string().max(50).optional(),
  timelineGoal: z.string().max(50).optional(),
  operatingSystem: z.string().max(50).optional(),
  selectedBranchIds: z.array(objectId).optional(),
  extraPreferences: z.string().max(1000).optional(),
})

export type SubmitOnboardingSchema = z.infer<typeof submitOnboardingSchema>
