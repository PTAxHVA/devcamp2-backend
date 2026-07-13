import { UserRoadmap } from '../models/user-roadmap.model.js'
import { UserTopic } from '../models/user-topic.model.js'
import { UserSectionProgress } from '../models/user-section-progress.model.js'
import { buildDailyActivity } from '../utils/streak.util.js'

/** Keep the earliest non-null completion (mirrors isEarlierCompletion in the
 *  backfill service) so a shared section's day-bucket is deterministic regardless
 *  of query order. */
const keepEarlier = (candidate: Date | null, current: Date | null): Date | null => {
  if (candidate === null) return current
  if (current === null) return candidate
  return candidate.getTime() < current.getTime() ? candidate : current
}

/**
 * Daily section-completion series across the learner's ACTIVE roadmaps over the
 * last `days` days, plus a `baseline` of completions before the window (so the FE
 * cumulative line starts from the true lifetime total). Dedupes by sectionId so a
 * topic shared across roadmaps (F18) counts once — the same rule the dashboard
 * weekly chart uses.
 */
export const getActivitySeries = async (userId: string, days: number) => {
  const userRoadmaps = await UserRoadmap.find({ userId, isActive: true }).select('_id').lean()
  const roadmapIds = userRoadmaps.map((r) => r._id)

  const userTopics = await UserTopic.find({ userRoadmapId: { $in: roadmapIds } })
    .select('_id')
    .lean()
  const userTopicIds = userTopics.map((t) => t._id)

  const progresses = await UserSectionProgress.find({
    userTopicId: { $in: userTopicIds },
    isCompleted: true,
  })
    .select('sectionId completedAt')
    .lean()

  // Count each finished section once, even when two roadmaps share the topic — keeping
  // the earliest completion so the day-bucket/baseline split can't flip on query order.
  const completedAtBySection = new Map<string, Date | null>()
  for (const p of progresses) {
    const key = p.sectionId.toString()
    if (!completedAtBySection.has(key)) {
      completedAtBySection.set(key, p.completedAt)
      continue
    }
    const current = completedAtBySection.get(key) ?? null
    completedAtBySection.set(key, keepEarlier(p.completedAt, current))
  }

  const { series, baseline } = buildDailyActivity([...completedAtBySection.values()], days)
  return { days, baseline, series }
}
