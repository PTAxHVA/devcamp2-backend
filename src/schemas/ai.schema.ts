import z from 'zod'
import { objectId } from './object-id.schema.js'
import { FeedbackSeverity } from '../types/enums.js'

export const roadmapSuggestSchema = z.object({
  masterRoadmapId: objectId,
  branchSelections: z
    .array(objectId)
    .min(1, 'At least one branch selection is required')
    .refine((branches) => new Set(branches).size === branches.length, {
      message: 'Branch selections must be unique',
    }),
})

export const roadmapFeedbackSchema = z.object({
  userRoadmapId: objectId,
  action: z.enum(['add', 'remove']),
  topicId: objectId,
})

export const jobReadinessSchema = z.object({
  role: z.string().trim().min(2, 'Role is required').max(80, 'Role is too long'),
})

export const explainMistakesSchema = z.object({
  attemptId: objectId,
})

export const aiResponseSchema = z.object({
  orderedTopicIds: z.array(z.string()),
  explanation: z.string(),
})

/** Shape Gemini must return for the job-readiness prompt (before id validation). */
export const jobReadinessAiResponseSchema = z.object({
  requiredTopicIds: z.array(z.string()).min(1),
})

/** Shape Gemini must return for the explain-mistakes prompt (before questionId validation). */
export const explainMistakesAiResponseSchema = z.object({
  explanations: z
    .array(
      z.object({
        questionId: z.string(),
        why: z.string().trim().min(1),
        reviewHint: z.string().trim().min(1),
      }),
    )
    .min(1),
})

export const aiFeedbackResponseSchema = z.object({
  // A blank Gemini reply must not be shown as real AI advice — reject it so the
  // service degrades to the curated fallback (tagged source:'fallback').
  feedback: z.string().trim().min(1),
  severity: z.nativeEnum(FeedbackSeverity),
})

export type RoadmapSuggestSchema = z.infer<typeof roadmapSuggestSchema>
export type RoadmapFeedbackSchema = z.infer<typeof roadmapFeedbackSchema>
export type JobReadinessSchema = z.infer<typeof jobReadinessSchema>
export type ExplainMistakesSchema = z.infer<typeof explainMistakesSchema>
