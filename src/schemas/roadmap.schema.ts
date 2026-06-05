import { z } from 'zod'
import { objectId } from './object-id.schema.js'
import { RoadmapSource } from '../types/enums.js'

const uniqueArray = (label: string) =>
  z
    .array(objectId)
    .refine((ids) => new Set(ids).size === ids.length, { message: `${label} must be unique` })

export const createRoadmapSchema = z.object({
  masterRoadmapId: objectId,
  branchSelections: uniqueArray('branchSelections').min(1, 'At least one branch is required'),
  // Optional explicit ordering coming from AI suggest / customize editor.
  // When present it must contain exactly the topics resolved from the selected branches.
  orderedTopicIds: uniqueArray('orderedTopicIds').optional(),
  sourceType: z.nativeEnum(RoadmapSource).optional(),
})

export type CreateRoadmapSchema = z.infer<typeof createRoadmapSchema>
