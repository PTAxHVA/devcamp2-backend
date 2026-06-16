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

// F15 Customize Editor: add/remove topics on an existing roadmap. Both lists are
// optional but at least one change is required, and the same topic can't be in both.
export const updateRoadmapSchema = z
  .object({
    addTopicIds: uniqueArray('addTopicIds').optional(),
    removeTopicIds: uniqueArray('removeTopicIds').optional(),
  })
  .refine((b) => (b.addTopicIds?.length ?? 0) + (b.removeTopicIds?.length ?? 0) > 0, {
    message: 'Provide at least one topic to add or remove',
  })
  .refine(
    (b) => {
      const add = new Set(b.addTopicIds ?? [])
      return !(b.removeTopicIds ?? []).some((id) => add.has(id))
    },
    { message: 'A topic cannot be both added and removed' },
  )

export type UpdateRoadmapSchema = z.infer<typeof updateRoadmapSchema>
