import { OnboardingQuestionnaire } from '../models/onboarding-questionnaire.model.js'
import { ApiError } from '../utils/api-error.js'
import type { SubmitOnboardingSchema } from '../schemas/onboarding.schema.js'

/**
 * Create or update the user's onboarding questionnaire (upsert — the model has a
 * unique userId). Idempotent: re-submitting (e.g. M3A partial then week-3 full)
 * updates the same doc instead of failing on the unique index. Marks completed.
 */
export const submitOnboarding = async (userId: string, body: SubmitOnboardingSchema) => {
  const doc = await OnboardingQuestionnaire.findOneAndUpdate(
    { userId },
    { $set: { ...body, completed: true } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean()

  if (!doc) {
    throw new ApiError(500, 'Failed to save onboarding questionnaire', 'ONBOARDING_SAVE_FAILED')
  }

  return {
    userId: doc.userId,
    rolePreference: doc.rolePreference,
    goal: doc.goal,
    completed: doc.completed,
    updatedAt: doc.updatedAt,
  }
}

/** Has the user finished onboarding? Returns the full questionnaire when present. */
export const getOnboardingStatus = async (userId: string) => {
  const questionnaire = await OnboardingQuestionnaire.findOne({ userId }).lean()
  return {
    completed: questionnaire?.completed ?? false,
    questionnaire: questionnaire ?? null,
  }
}
