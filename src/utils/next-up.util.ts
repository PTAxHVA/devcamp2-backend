/**
 * "Continue Learning" next-up derivation (BN2b).
 *
 * UserSectionProgress rows are only written when a quiz is graded, so a learner on
 * the happy path (never failed a quiz) has no isCompleted:false row and the
 * dashboard card had nothing to show. Derive the next section to study per roadmap
 * instead, mirroring the journey page's Up-Next order:
 *   1. first topic (by orderIndex) with SOME but not all published sections done,
 *   2. else first topic (by orderIndex) with any published section left,
 * and inside the chosen topic, the first published section without completed
 * progress. Fully completed roadmaps (or ones with no published sections) get no
 * entry, which keeps the card hidden for them.
 */

type IdLike = { toString(): string }

export interface NextUpUserTopic {
  _id: IdLike
  userRoadmapId: IdLike
  topicId: IdLike
  orderIndex: number
}

export interface NextUpSection {
  _id: IdLike
  topicId: IdLike
  name: string
  slug: string
  orderIndex: number
  isPublished: boolean
}

export interface NextUpProgress {
  userTopicId: IdLike
  sectionId: IdLike
  isCompleted: boolean
}

export interface NextUpEntry {
  topicId: string
  sectionId: string
  name: string
  slug: string
}

const byOrderIndexThenId = <T extends { orderIndex: number; _id: IdLike }>(a: T, b: T): number =>
  a.orderIndex - b.orderIndex || a._id.toString().localeCompare(b._id.toString())

/** Map of userRoadmapId -> the next section the learner should study there. */
export const buildNextUpMap = (
  userTopics: NextUpUserTopic[],
  sections: NextUpSection[],
  progresses: NextUpProgress[],
): Map<string, NextUpEntry> => {
  const sectionsByTopic = new Map<string, NextUpSection[]>()
  for (const s of sections) {
    if (!s.isPublished) continue
    const key = s.topicId.toString()
    const list = sectionsByTopic.get(key)
    if (list) list.push(s)
    else sectionsByTopic.set(key, [s])
  }
  for (const list of sectionsByTopic.values()) {
    list.sort(byOrderIndexThenId)
  }

  const completedByUserTopic = new Map<string, Set<string>>()
  for (const p of progresses) {
    if (!p.isCompleted) continue
    const key = p.userTopicId.toString()
    const set = completedByUserTopic.get(key) ?? new Set<string>()
    set.add(p.sectionId.toString())
    completedByUserTopic.set(key, set)
  }

  const topicsByRoadmap = new Map<string, NextUpUserTopic[]>()
  for (const t of userTopics) {
    const key = t.userRoadmapId.toString()
    const list = topicsByRoadmap.get(key)
    if (list) list.push(t)
    else topicsByRoadmap.set(key, [t])
  }

  const nextUp = new Map<string, NextUpEntry>()
  for (const [roadmapId, topics] of topicsByRoadmap) {
    topics.sort(byOrderIndexThenId)

    let firstIncomplete: NextUpEntry | null = null
    let inProgress: NextUpEntry | null = null

    for (const t of topics) {
      const secs = sectionsByTopic.get(t.topicId.toString()) ?? []
      if (secs.length === 0) continue
      const done = completedByUserTopic.get(t._id.toString())
      const next = secs.find((s) => !done?.has(s._id.toString()))
      if (!next) continue // topic fully completed

      const entry: NextUpEntry = {
        topicId: t.topicId.toString(),
        sectionId: next._id.toString(),
        name: next.name,
        slug: next.slug,
      }
      if (!firstIncomplete) firstIncomplete = entry
      const doneCount = done ? secs.filter((s) => done.has(s._id.toString())).length : 0
      if (doneCount > 0) {
        // First partially-done topic in roadmap order — "pick up where you left off".
        inProgress = entry
        break
      }
    }

    const chosen = inProgress ?? firstIncomplete
    if (chosen) nextUp.set(roadmapId, chosen)
  }

  return nextUp
}
