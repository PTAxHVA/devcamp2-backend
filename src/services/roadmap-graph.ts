import { TopicStatus } from '../types/enums.js'

/**
 * 4-state status the FE renders per topic node.
 * Derived from the raw UserTopic status + prerequisite completion:
 * - completed   : UserTopic.status === COMPLETED
 * - in_progress : UserTopic.status === IN_PROGRESS
 * - available   : NOT_STARTED and every in-roadmap prerequisite is completed
 * - locked      : NOT_STARTED and at least one in-roadmap prerequisite is not completed
 */
export type RoadmapTopicStatus = 'locked' | 'available' | 'in_progress' | 'completed'

/** One topic fed into the graph builder (from UserTopic+MasterTopic, or MasterTopic only for demo). */
export interface GraphTopicInput {
  masterTopicId: string
  userTopicId: string | null
  name: string
  orderIndex: number
  estimatedHours: number
  /** Prerequisite master topic ids (may include ids outside this roadmap — filtered here). */
  prerequisiteTopicIds: string[]
  /** Raw UserTopic status, or null when there is no user progress (demo). */
  rawStatus: TopicStatus | null
  sectionTotal: number
  sectionCompleted: number
}

export interface GraphTopic {
  masterTopicId: string
  userTopicId: string | null
  name: string
  status: RoadmapTopicStatus
  orderIndex: number
  estimatedHours: number
  sectionTotal: number
  sectionCompleted: number
  /** Prerequisites that are part of THIS roadmap (used by the FE for edges/locking hints). */
  prerequisiteTopicIds: string[]
}

export interface RoadmapGraph {
  topics: GraphTopic[]
  edges: { source: string; target: string }[]
}

/**
 * Pure transform: turn a topic list into the FE roadmap graph
 * ({ topics with 4-state status, prereq→dependent edges }). Shared by the user
 * roadmap detail endpoint and the public demo endpoint so both stay consistent.
 */
export const buildRoadmapGraph = (inputs: GraphTopicInput[]): RoadmapGraph => {
  const idSet = new Set(inputs.map((t) => t.masterTopicId))

  // Completed set first — needed to decide available vs locked for the rest.
  const completed = new Set(
    inputs.filter((t) => t.rawStatus === TopicStatus.COMPLETED).map((t) => t.masterTopicId),
  )

  const topics: GraphTopic[] = inputs.map((t) => {
    // Only prerequisites inside this roadmap affect status / edges.
    const prereqs = t.prerequisiteTopicIds.filter((id) => idSet.has(id))

    let status: RoadmapTopicStatus
    if (t.rawStatus === TopicStatus.COMPLETED) {
      status = 'completed'
    } else if (t.rawStatus === TopicStatus.IN_PROGRESS) {
      status = 'in_progress'
    } else {
      status = prereqs.every((id) => completed.has(id)) ? 'available' : 'locked'
    }

    return {
      masterTopicId: t.masterTopicId,
      userTopicId: t.userTopicId,
      name: t.name,
      status,
      orderIndex: t.orderIndex,
      estimatedHours: t.estimatedHours,
      sectionTotal: t.sectionTotal,
      sectionCompleted: t.sectionCompleted,
      prerequisiteTopicIds: prereqs,
    }
  })

  // prereq -> dependent edges, deduped, both ends inside this roadmap.
  const seen = new Set<string>()
  const edges: { source: string; target: string }[] = []
  for (const t of inputs) {
    for (const reqId of t.prerequisiteTopicIds) {
      if (!idSet.has(reqId)) continue
      const key = `${reqId}->${t.masterTopicId}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ source: reqId, target: t.masterTopicId })
    }
  }

  return {
    topics: topics.sort((a, b) => a.orderIndex - b.orderIndex),
    edges,
  }
}
