import { UserProfile } from '../models/user-profile.model.js'
import { User } from '../models/user.model.js'
import { UserRoadmap } from '../models/user-roadmap.model.js'
import { UserTopic } from '../models/user-topic.model.js'
import { MasterRoadmap } from '../models/master-roadmap.model.js'
import { MasterTopic } from '../models/master-topic.model.js'
import { Section } from '../models/section.model.js'
import { UserSectionProgress } from '../models/user-section-progress.model.js'
import { Quiz } from '../models/quiz.model.js'
import { QuizAttempt } from '../models/quiz-attempt.model.js'
import { ApiError } from '../utils/api-error.js'
import { calculateCurrentStreak } from '../utils/streak.util.js'

export interface VerifiedTopicItem {
  name: string
  masteryPct: number
}

// One 404 for BOTH "token doesn't exist" and "passport is private/owner
// deactivated" — a public caller must not be able to tell the cases apart.
const passportNotFound = () => new ApiError(404, 'Passport not found', 'PASSPORT_NOT_FOUND')

/**
 * Public Verified Skill Passport payload for a share token.
 *
 * "Verified topic" mirrors the dashboard "Completed Topics" rule
 * (dashboard.service.ts): a master topic counts when it has published sections
 * and EVERY published section is completed (quiz-passed), deduped across
 * roadmaps that share the topic. This service additionally returns the LIST of
 * those topics (name + mastery) instead of just the count.
 *
 * Read-only. Never includes email or raw user ids.
 */
export const getPublicPassport = async (shareToken: string) => {
  // Every query below projects ONLY the fields the aggregation needs (e.g. no
  // Section.resourceList payloads), and the data volume is naturally bounded by
  // the 2-roadmap cap × the curated topic library — keeps one public hit cheap.
  const profile = await UserProfile.findOne({ shareToken, isPublic: true })
    .select('userId level streak lastActivityDate longestStreak')
    .lean()
  if (!profile) throw passportNotFound()

  const user = await User.findById(profile.userId).select('username isActive').lean()
  if (!user || user.isActive === false) throw passportNotFound()

  const userRoadmaps = await UserRoadmap.find({ userId: profile.userId, isActive: true })
    .select('roadmapId')
    .lean()
  const roadmapDocs = await MasterRoadmap.find({
    _id: { $in: userRoadmaps.map((r) => r.roadmapId) },
  })
    .select('roleName')
    .lean()

  const userTopics = await UserTopic.find({
    userRoadmapId: { $in: userRoadmaps.map((r) => r._id) },
  })
    .select('userRoadmapId topicId')
    .lean()
  const masterTopicIds = [...new Set(userTopics.map((t) => t.topicId.toString()))]

  const [sections, sectionProgresses] = await Promise.all([
    Section.find({ topicId: { $in: masterTopicIds } })
      .select('topicId isPublished')
      .lean(),
    UserSectionProgress.find({ userTopicId: { $in: userTopics.map((t) => t._id) } })
      .select('userTopicId sectionId isCompleted')
      .lean(),
  ])

  // Published sections only — same basis as the dashboard tile and topic view.
  const publishedSectionIds = new Set(
    sections.filter((s) => s.isPublished).map((s) => s._id.toString()),
  )
  const publishedSectionsByTopic = new Map<string, number>()
  const sectionToTopic = new Map<string, string>()
  for (const s of sections) {
    if (!s.isPublished) continue
    const tId = s.topicId.toString()
    publishedSectionsByTopic.set(tId, (publishedSectionsByTopic.get(tId) ?? 0) + 1)
    sectionToTopic.set(s._id.toString(), tId)
  }

  const completedSectionsByUserTopic = new Map<string, number>()
  for (const p of sectionProgresses) {
    if (!p.isCompleted || !publishedSectionIds.has(p.sectionId.toString())) continue
    const id = p.userTopicId.toString()
    completedSectionsByUserTopic.set(id, (completedSectionsByUserTopic.get(id) ?? 0) + 1)
  }

  // Dedupe by master topic: a topic shared across two roadmaps is verified once.
  const verifiedTopicIds = new Set<string>()
  for (const t of userTopics) {
    const total = publishedSectionsByTopic.get(t.topicId.toString()) ?? 0
    const done = completedSectionsByUserTopic.get(t._id.toString()) ?? 0
    if (total > 0 && done >= total) verifiedTopicIds.add(t.topicId.toString())
  }

  const masteryByTopic = await buildMasteryByTopic(
    profile.userId.toString(),
    publishedSectionIds,
    sectionToTopic,
  )

  const topicDocs = await MasterTopic.find({ _id: { $in: [...verifiedTopicIds] } })
    .select('name')
    .lean()
  const verifiedTopics: VerifiedTopicItem[] = topicDocs
    .map((t) => ({
      name: t.name,
      // Every section quiz needed ≥80% to verify, so 100 is a safe floor-less
      // fallback if an attempt row is ever missing (e.g. shared-topic backfill).
      masteryPct: masteryByTopic.get(t._id.toString()) ?? 100,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // Per-roadmap completion for the public certificate: a roadmap earns one when
  // EVERY topic it contains is quiz-verified (shared-topic verification counts
  // for every roadmap that includes the topic, mirroring progress sync).
  const roadmapNameById = new Map(roadmapDocs.map((r) => [r._id.toString(), r.roleName]))
  const topicsByUserRoadmap = new Map<string, Set<string>>()
  for (const t of userTopics) {
    const rId = t.userRoadmapId.toString()
    const topicIds = topicsByUserRoadmap.get(rId) ?? new Set<string>()
    topicIds.add(t.topicId.toString())
    topicsByUserRoadmap.set(rId, topicIds)
  }
  const roadmaps = userRoadmaps
    .map((r) => {
      const topicIds = topicsByUserRoadmap.get(r._id.toString()) ?? new Set<string>()
      const verifiedCount = [...topicIds].filter((id) => verifiedTopicIds.has(id)).length
      return {
        name: roadmapNameById.get(r.roadmapId.toString()) ?? 'Roadmap',
        topicsCount: topicIds.size,
        verifiedCount,
        isCompleted: topicIds.size > 0 && verifiedCount === topicIds.size,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    username: user.username,
    level: profile.level,
    streak: calculateCurrentStreak(profile.streak || 0, profile.lastActivityDate),
    longestStreak: profile.longestStreak || 0,
    verifiedTopics,
    roadmaps,
    completedCount: verifiedTopics.length,
    totalCount: masterTopicIds.length,
  }
}

/**
 * Mastery per master topic = mean of the learner's submitted score per quiz
 * across the topic's published sections (one quiz per section, one attempt row
 * per user+quiz). Same "best score per quiz" basis as the dashboard Quiz Avg.
 */
const buildMasteryByTopic = async (
  userId: string,
  publishedSectionIds: Set<string>,
  sectionToTopic: Map<string, string>,
): Promise<Map<string, number>> => {
  const quizzes = await Quiz.find({ sectionId: { $in: [...publishedSectionIds] } })
    .select('sectionId')
    .lean()
  const quizToTopic = new Map<string, string>()
  for (const q of quizzes) {
    const topicId = sectionToTopic.get(q.sectionId.toString())
    if (topicId) quizToTopic.set(q._id.toString(), topicId)
  }

  const attempts = await QuizAttempt.find({ userId, submittedAt: { $ne: null } })
    .select('quizId score')
    .lean()
  const scoresByTopic = new Map<string, number[]>()
  for (const a of attempts) {
    const topicId = quizToTopic.get(a.quizId.toString())
    if (!topicId) continue
    const scores = scoresByTopic.get(topicId) ?? []
    scores.push(a.score ?? 0)
    scoresByTopic.set(topicId, scores)
  }

  const masteryByTopic = new Map<string, number>()
  for (const [topicId, scores] of scoresByTopic) {
    const mean = scores.reduce((sum, v) => sum + v, 0) / scores.length
    masteryByTopic.set(topicId, Math.round(mean))
  }
  return masteryByTopic
}
