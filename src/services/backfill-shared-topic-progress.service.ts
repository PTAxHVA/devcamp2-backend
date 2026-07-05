import { Types } from 'mongoose'
import { UserRoadmap } from '../models/user-roadmap.model.js'
import { UserTopic } from '../models/user-topic.model.js'
import { UserSectionProgress } from '../models/user-section-progress.model.js'

export interface BackfillStats {
  usersScanned: number
  usersWithSharedTopics: number
  sharedTopicGroups: number
  rowsInserted: number
  rowsUpdated: number
  rowsAlreadyInSync: number
}

/**
 * Prefer the earliest real completion date so a propagated row never post-dates the
 * actual completion — streaks count "≥1 section/day" by completedAt, so stamping a
 * later date would silently inflate a learner's streak.
 */
const isEarlierCompletion = (candidate: Date | null, current: Date | null): boolean => {
  if (candidate === null) return false
  if (current === null) return true
  return candidate.getTime() < current.getTime()
}

/**
 * One-time backfill: retroactively mirror completed shared-topic section progress
 * across a learner's active roadmaps.
 *
 * A quiz pass that predates the write-time mirror (BE #50) wrote a completed
 * UserSectionProgress to only ONE of the UserTopics enrolling a shared master topic,
 * leaving the other roadmap(s) stale — and a passed quiz is idempotent + cooldown-gated,
 * so the live mirror never re-runs to repair it. This walks every (user, shared topic)
 * group and ensures every sibling UserTopic carries each section's completion.
 *
 * Guarantees:
 * - Copies the SOURCE row's original completedAt/startedAt — never Date.now() — so
 *   streaks and weekly progress stay historically accurate.
 * - Idempotent: only inserts missing rows and upgrades not-completed rows; never
 *   overwrites an already-completed row. Re-running is a no-op.
 * - Touches ONLY UserSectionProgress (no quiz attempts), so quizAvg is unaffected and
 *   completedTopics already dedupes shared topics.
 */
export const backfillAllSharedTopicProgress = async ({
  dryRun,
}: {
  dryRun: boolean
}): Promise<BackfillStats> => {
  const stats: BackfillStats = {
    usersScanned: 0,
    usersWithSharedTopics: 0,
    sharedTopicGroups: 0,
    rowsInserted: 0,
    rowsUpdated: 0,
    rowsAlreadyInSync: 0,
  }

  const userIds = (await UserRoadmap.distinct('userId', { isActive: true })) as Types.ObjectId[]
  stats.usersScanned = userIds.length

  for (const userId of userIds) {
    const activeRoadmaps = await UserRoadmap.find({ userId, isActive: true }).select('_id').lean()
    const roadmapIds = activeRoadmaps.map((r) => r._id)

    const userTopics = await UserTopic.find({ userRoadmapId: { $in: roadmapIds } })
      .select('_id topicId')
      .lean()

    // Group the learner's UserTopics by master topic; a group of >=2 = a shared topic.
    const siblingsByTopic = new Map<string, Types.ObjectId[]>()
    for (const ut of userTopics) {
      const key = ut.topicId.toString()
      const arr = siblingsByTopic.get(key) ?? []
      arr.push(ut._id)
      siblingsByTopic.set(key, arr)
    }

    let userHadShared = false
    for (const siblingIds of siblingsByTopic.values()) {
      if (siblingIds.length < 2) continue
      userHadShared = true
      stats.sharedTopicGroups += 1

      const rows = await UserSectionProgress.find({ userTopicId: { $in: siblingIds } })
        .select('userTopicId sectionId isCompleted startedAt completedAt')
        .lean()

      // Canonical completed state per section: earliest real completion among siblings.
      const canonical = new Map<string, { startedAt: Date; completedAt: Date | null }>()
      for (const r of rows) {
        if (!r.isCompleted) continue
        const sectionKey = r.sectionId.toString()
        const current = canonical.get(sectionKey)
        if (!current || isEarlierCompletion(r.completedAt, current.completedAt)) {
          canonical.set(sectionKey, { startedAt: r.startedAt, completedAt: r.completedAt })
        }
      }
      if (canonical.size === 0) continue

      // Current completion state per (sibling, section): true / false / undefined (no row).
      const existingByKey = new Map<string, boolean>()
      for (const r of rows) {
        existingByKey.set(`${r.userTopicId.toString()}:${r.sectionId.toString()}`, r.isCompleted)
      }

      for (const siblingId of siblingIds) {
        for (const [sectionKey, canon] of canonical) {
          const existing = existingByKey.get(`${siblingId.toString()}:${sectionKey}`)
          const sectionId = new Types.ObjectId(sectionKey)

          if (existing === undefined) {
            stats.rowsInserted += 1
            if (!dryRun) {
              // $setOnInsert-only upsert: a no-op if the row somehow already exists, so
              // it can never violate the unique (userTopicId, sectionId) index.
              await UserSectionProgress.updateOne(
                { userTopicId: siblingId, sectionId },
                {
                  $setOnInsert: {
                    isCompleted: true,
                    startedAt: canon.startedAt,
                    completedAt: canon.completedAt,
                  },
                },
                { upsert: true },
              )
            }
          } else if (existing === false) {
            stats.rowsUpdated += 1
            if (!dryRun) {
              // Upgrade the stale row: propagate completion but keep its own startedAt.
              await UserSectionProgress.updateOne(
                { userTopicId: siblingId, sectionId, isCompleted: false },
                { $set: { isCompleted: true, completedAt: canon.completedAt } },
              )
            }
          } else {
            stats.rowsAlreadyInSync += 1
          }
        }
      }
    }
    if (userHadShared) stats.usersWithSharedTopics += 1
  }

  return stats
}
