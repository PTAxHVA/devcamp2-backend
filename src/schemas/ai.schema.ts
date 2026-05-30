import z from 'zod'
import { objectId } from './object-id.schema.js'

export const roadmapSuggestSchema = z.object({
  masterRoadmapId: objectId,
  branchSelections: z.array(objectId).min(1, 'At least one branch selection is required'),
})

export type RoadmapSuggestSchema = z.infer<typeof roadmapSuggestSchema>
