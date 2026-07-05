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

export const aiResponseSchema = z.object({
  orderedTopicIds: z.array(z.string()),
  explanation: z.string(),
})

/** Shape Gemini must return for the job-readiness prompt (before id validation). */
export const jobReadinessAiResponseSchema = z.object({
  requiredTopicIds: z.array(z.string()).min(1),
})

export const aiFeedbackResponseSchema = z.object({
  feedback: z.string(),
  severity: z.nativeEnum(FeedbackSeverity),
})

export type RoadmapSuggestSchema = z.infer<typeof roadmapSuggestSchema>
export type RoadmapFeedbackSchema = z.infer<typeof roadmapFeedbackSchema>
export type JobReadinessSchema = z.infer<typeof jobReadinessSchema>
