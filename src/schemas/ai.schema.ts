import z from 'zod'
import { objectId } from './object-id.schema.js'
import { EditAction, FeedbackSeverity } from '../types/enums.js'

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
  action: z.nativeEnum(EditAction),
  topicId: objectId,
})

export const aiResponseSchema = z.object({
  orderedTopicIds: z.array(z.string()),
  explanation: z.string(),
})

export const aiFeedbackResponseSchema = z.object({
  feedback: z.string(),
  severity: z.nativeEnum(FeedbackSeverity),
})

export type RoadmapSuggestSchema = z.infer<typeof roadmapSuggestSchema>
export type RoadmapFeedbackSchema = z.infer<typeof roadmapFeedbackSchema>
