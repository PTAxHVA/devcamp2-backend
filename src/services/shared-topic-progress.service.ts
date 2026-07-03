import { ClientSession, Types } from 'mongoose'
import { UserRoadmap } from '../models/user-roadmap.model.js'
import { UserTopic } from '../models/user-topic.model.js'
import { UserSectionProgress } from '../models/user-section-progress.model.js'

interface NewUserTopic {
  _id: Types.ObjectId
  topicId: Types.ObjectId
}

interface CompletedSource {
  sectionId: Types.ObjectId
  startedAt: Date
  completedAt: Date | null
}

/**
 * Enroll-time counterpart of the write-time mirror in submitAndGradeQuiz.
 *
 * When a learner adds a roadmap (F18 "add another role") whose topics they have
 * ALREADY completed sections of in another active roadmap, copy that completed
 * UserSectionProgress onto the freshly-created UserTopic(s) so the new roadmap
 * reflects the progress immediately instead of leaving it stale until a re-quiz.
 *
 * Runs inside the caller's transaction. No-op when nothing is shared/completed.
 * Only inserts for the passed-in NEW UserTopics (fresh _id, no progress yet), so
 * the unique (userTopicId, sectionId) index can never be violated.
 */
export const backfillSharedTopicProgress = async (
  userId: string,
  newUserTopics: NewUserTopic[],
  session: ClientSession,
): Promise<void> => {
  if (newUserTopics.length === 0) return

  const newIds = new Set(newUserTopics.map((t) => t._id.toString()))
  const topicIds = newUserTopics.map((t) => t.topicId)

  const activeRoadmaps = await UserRoadmap.find({ userId, isActive: true })
    .select('_id')
    .session(session)
    .lean()

  // Sibling enrollments of the same topics in any active roadmap, minus the new rows.
  const siblings = await UserTopic.find({
    userRoadmapId: { $in: activeRoadmaps.map((r) => r._id) },
    topicId: { $in: topicIds },
  })
    .select('_id topicId')
    .session(session)
    .lean()

  const siblingIds: Types.ObjectId[] = []
  const siblingTopicById = new Map<string, string>()
  for (const s of siblings) {
    if (newIds.has(s._id.toString())) continue
    siblingIds.push(s._id)
    siblingTopicById.set(s._id.toString(), s.topicId.toString())
  }
  if (siblingIds.length === 0) return

  const completed = await UserSectionProgress.find({
    userTopicId: { $in: siblingIds },
    isCompleted: true,
  })
    .select('userTopicId sectionId startedAt completedAt')
    .session(session)
    .lean()
  if (completed.length === 0) return

  // topicId -> (sectionId -> source progress), deduping a section shared by siblings.
  const perTopic = new Map<string, Map<string, CompletedSource>>()
  for (const p of completed) {
    const topicKey = siblingTopicById.get(p.userTopicId.toString())
    if (!topicKey) continue
    const sectionMap = perTopic.get(topicKey) ?? new Map<string, CompletedSource>()
    const sectionKey = p.sectionId.toString()
    if (!sectionMap.has(sectionKey)) {
      sectionMap.set(sectionKey, {
        sectionId: p.sectionId,
        startedAt: p.startedAt,
        completedAt: p.completedAt,
      })
    }
    perTopic.set(topicKey, sectionMap)
  }

  const docs = newUserTopics.flatMap((t) => {
    const sectionMap = perTopic.get(t.topicId.toString())
    if (!sectionMap) return []
    return [...sectionMap.values()].map((p) => ({
      userTopicId: t._id,
      sectionId: p.sectionId,
      isCompleted: true,
      startedAt: p.startedAt,
      completedAt: p.completedAt,
    }))
  })

  if (docs.length > 0) {
    await UserSectionProgress.insertMany(docs, { session })
  }
}
