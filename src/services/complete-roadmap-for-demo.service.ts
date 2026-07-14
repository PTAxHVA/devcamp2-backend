import { Types } from 'mongoose'
import { User } from '../models/user.model.js'
import { UserRoadmap } from '../models/user-roadmap.model.js'
import { UserTopic } from '../models/user-topic.model.js'
import { Section } from '../models/section.model.js'
import { UserSectionProgress } from '../models/user-section-progress.model.js'

export interface CompleteDemoStats {
  email: string
  userFound: boolean
  /** false when the account is deactivated — the public Passport won't render for it. */
  userActive: boolean
  roadmapsProcessed: number
  topicsProcessed: number
  topicsWithoutSections: number
  sectionsTargeted: number
  rowsInserted: number
  rowsUpgraded: number
  rowsAlreadyComplete: number
  /**
   * true only when EVERY active roadmap is now 100% (has topics, and every topic has
   * published sections that are all completed). false when there is no active roadmap,
   * a roadmap has no topics, or a topic has no published sections — the caller must not
   * claim "100%" otherwise (the FE certificate gate requires a non-empty, all-completed
   * topic list).
   */
  fullyComplete: boolean
}

export interface CompleteDemoOptions {
  email: string
  dryRun: boolean
  /** Completion timestamp stamped on new/upgraded rows. Defaults to now. */
  completedAt?: Date
}

const emptyStats = (email: string): CompleteDemoStats => ({
  email,
  userFound: false,
  userActive: false,
  roadmapsProcessed: 0,
  topicsProcessed: 0,
  topicsWithoutSections: 0,
  sectionsTargeted: 0,
  rowsInserted: 0,
  rowsUpgraded: 0,
  rowsAlreadyComplete: 0,
  fullyComplete: false,
})

/**
 * DEMO helper (not for real learners): mark EVERY published section of EVERY topic in
 * a demo account's active roadmap(s) as completed, so the account reads 100% — the
 * roadmap-complete certificate + celebration render (topic status = "all published
 * sections completed", derived only from UserSectionProgress) and the Verified Skill
 * Passport fills with verified-skill badges. Mastery shows the passport's `?? 100`
 * fallback because no quiz attempts are fabricated.
 *
 * Additive + idempotent, mirroring backfill-shared-topic-progress: only inserts missing
 * rows and upgrades not-completed ones; never overwrites an already-completed row;
 * touches ONLY UserSectionProgress (no quiz attempts, so quizAvg/attempt history are
 * untouched). Re-running is a no-op. A topic with no published sections can never be
 * "completed" and is reported via `topicsWithoutSections` rather than silently skipped.
 */
export const completeRoadmapForDemo = async ({
  email,
  dryRun,
  completedAt,
}: CompleteDemoOptions): Promise<CompleteDemoStats> => {
  const normalizedEmail = email.trim().toLowerCase()
  const stats = emptyStats(normalizedEmail)
  const now = completedAt ?? new Date()

  const user = await User.findOne({ email: normalizedEmail }).select('_id isActive').lean()
  if (!user) return stats
  stats.userFound = true
  stats.userActive = user.isActive !== false

  const roadmaps = await UserRoadmap.find({ userId: user._id, isActive: true }).select('_id').lean()
  stats.roadmapsProcessed = roadmaps.length
  if (roadmaps.length === 0) return stats

  const userTopics = await UserTopic.find({
    userRoadmapId: { $in: roadmaps.map((r) => r._id) },
  })
    .select('_id topicId')
    .lean()
  stats.topicsProcessed = userTopics.length
  if (userTopics.length === 0) return stats

  // Published sections per master topic — same basis the FE uses to mark a topic
  // "completed" (dashboard/passport/roadmap-graph: all published sections done).
  const masterTopicIds = [...new Set(userTopics.map((t) => t.topicId.toString()))]
  const sections = await Section.find({ topicId: { $in: masterTopicIds }, isPublished: true })
    .select('_id topicId')
    .lean()
  const sectionsByTopic = new Map<string, string[]>()
  for (const s of sections) {
    const key = s.topicId.toString()
    const arr = sectionsByTopic.get(key) ?? []
    arr.push(s._id.toString())
    sectionsByTopic.set(key, arr)
  }

  for (const ut of userTopics) {
    const sectionKeys = sectionsByTopic.get(ut.topicId.toString()) ?? []
    if (sectionKeys.length === 0) {
      // No published sections → this topic can never read as "completed", so the
      // roadmap won't reach 100% until content is published. Surface it, don't hide it.
      stats.topicsWithoutSections += 1
      continue
    }

    const existing = await UserSectionProgress.find({
      userTopicId: ut._id,
      sectionId: { $in: sectionKeys },
    })
      .select('sectionId isCompleted')
      .lean()
    const stateBySection = new Map(existing.map((p) => [p.sectionId.toString(), p.isCompleted]))

    for (const sectionKey of sectionKeys) {
      stats.sectionsTargeted += 1
      const state = stateBySection.get(sectionKey)
      const sectionId = new Types.ObjectId(sectionKey)

      if (state === undefined) {
        stats.rowsInserted += 1
        if (!dryRun) {
          // $setOnInsert-only upsert: a no-op if the row already exists, so it can
          // never violate the unique (userTopicId, sectionId) index.
          await UserSectionProgress.updateOne(
            { userTopicId: ut._id, sectionId },
            { $setOnInsert: { isCompleted: true, startedAt: now, completedAt: now } },
            { upsert: true },
          )
        }
      } else if (state === false) {
        stats.rowsUpgraded += 1
        if (!dryRun) {
          await UserSectionProgress.updateOne(
            { userTopicId: ut._id, sectionId, isCompleted: false },
            { $set: { isCompleted: true, completedAt: now } },
          )
        }
      } else {
        stats.rowsAlreadyComplete += 1
      }
    }
  }

  // Reached only when the account has topics: it is fully complete iff every topic had
  // published sections to target (topicsWithoutSections === 0). Every published section
  // of every topic is now completed, so the roadmap reads 100%.
  stats.fullyComplete = stats.topicsProcessed > 0 && stats.topicsWithoutSections === 0

  return stats
}
