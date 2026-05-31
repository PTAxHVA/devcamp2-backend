import z from 'zod'
import { objectId } from './object-id.schema.js'

export const roadmapSuggestSchema = z.object({
  masterRoadmapId: objectId,
  branchSelections: z
    .array(objectId)
    .min(1, 'At least one branch selection is required')
    .refine((branches) => new Set(branches).size === branches.length, {
      message: 'Branch selections must be unique',
    }),
})

export type RoadmapSuggestSchema = z.infer<typeof roadmapSuggestSchema>
