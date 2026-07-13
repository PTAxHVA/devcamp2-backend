import { UserProfile } from '../models/user-profile.model.js'
import { Section } from '../models/section.model.js'
import { UserTopic } from '../models/user-topic.model.js'
import { UserRoadmap } from '../models/user-roadmap.model.js'
import { MasterRoadmap } from '../models/master-roadmap.model.js'
import { UserSectionProgress, IUserSectionProgress } from '../models/user-section-progress.model.js'
import { QuizAttempt } from '../models/quiz-attempt.model.js'
import { SkillLevel } from '../types/enums.js'
import { calculateCurrentStreak, buildWeeklyProgress } from '../utils/streak.util.js'
import { buildNextUpMap } from '../utils/next-up.util.js'
import { keepEarlierCompletion } from '../utils/completion.util.js'

export const getDashboardAnalytics = async (userId: string) => {
  // Only active roadmaps drive dashboard UI — soft-deleted ones (isActive:false)
  // must not appear in roadmaps / continueLearning / progress.
  const [userProfile, userRoadmaps, publishedRoadmaps] = await Promise.all([
    UserProfile.findOne({ userId }).lean(),
    UserRoadmap.find({ userId, isActive: true }).lean(),
    MasterRoadmap.find({ isPublished: true }).select('roleName').lean(),
  ])

  // F18: roles the learner can still add = published roadmaps minus active ones.
  const activeRoadmapIds = new Set(userRoadmaps.map((r) => r.roadmapId.toString()))
  const availableRolesForAdd = publishedRoadmaps
    .filter((r) => !activeRoadmapIds.has(r._id.toString()))
    .map((r) => ({ id: r._id, roleName: r.roleName }))

  const currentStreak = calculateCurrentStreak(
    userProfile?.streak || 0,
    userProfile?.lastActivityDate,
  )

  const streak = {
    userId,
    streak: currentStreak,
    lastActivityDate: userProfile?.lastActivityDate || null,
    longestStreak: userProfile?.longestStreak || 0,
  }

  const roadmapIds = userRoadmaps.map((r) => r._id)
  const userTopics = await UserTopic.find({ userRoadmapId: { $in: roadmapIds } }).lean()
  const userTopicIds = userTopics.map((t) => t._id)
  const masterTopicIds = userTopics.map((t) => t.topicId)

  const [sections, sectionProgresses] = await Promise.all([
    Section.find({ topicId: { $in: masterTopicIds } }).lean(),
    UserSectionProgress.find({ userTopicId: { $in: userTopicIds } }).lean(),
  ])

  const userTopicToMasterTopic = new Map(
    userTopics.map((t) => [t._id.toString(), t.topicId.toString()]),
  )
  const userTopicToRoadmap = new Map(
    userTopics.map((t) => [t._id.toString(), t.userRoadmapId.toString()]),
  )
  const sectionMap = new Map(sections.map((s) => [s._id.toString(), s]))

  const roadmapSectionCounts = new Map<string, number>()
  const roadmapCompletedCounts = new Map<string, number>()
  const latestProgressPerRoadmap = new Map<string, IUserSectionProgress>()

  for (const r of userRoadmaps) {
    roadmapSectionCounts.set(r._id.toString(), 0)
    roadmapCompletedCounts.set(r._id.toString(), 0)
  }

  const sectionsPerMasterTopic = new Map<string, number>()
  for (const s of sections) {
    const tId = s.topicId.toString()
    sectionsPerMasterTopic.set(tId, (sectionsPerMasterTopic.get(tId) || 0) + 1)
  }

  for (const t of userTopics) {
    const count = sectionsPerMasterTopic.get(t.topicId.toString()) || 0
    const rId = t.userRoadmapId.toString()
    roadmapSectionCounts.set(rId, (roadmapSectionCounts.get(rId) || 0) + count)
  }

  for (const p of sectionProgresses) {
    const rId = userTopicToRoadmap.get(p.userTopicId.toString())
    if (!rId) continue

    if (p.isCompleted) {
      roadmapCompletedCounts.set(rId, (roadmapCompletedCounts.get(rId) || 0) + 1)
    } else {
      const currentLatest = latestProgressPerRoadmap.get(rId)
      if (
        !currentLatest ||
        new Date(p.startedAt).getTime() > new Date(currentLatest.startedAt).getTime()
      ) {
        latestProgressPerRoadmap.set(rId, p)
      }
    }
  }

  const progress = userRoadmaps.map((roadmap) => {
    const rId = roadmap._id.toString()
    const total = roadmapSectionCounts.get(rId) || 0
    const completed = roadmapCompletedCounts.get(rId) || 0
    return {
      roadmapId: roadmap.roadmapId,
      totalSections: total,
      totalCompletedSections: completed,
      roadmapCompletionPercentage: total > 0 ? (completed / total) * 100 : 0,
    }
  })

  // BN2b: rows in UserSectionProgress only exist once a quiz was graded, so a
  // happy-path learner (never failed) had no in-progress row and the Continue
  // Learning card never rendered. Derive a journey-order "next up" per roadmap
  // as the fallback; an actual in-progress (failed) section still wins below.
  const nextUpByRoadmap = buildNextUpMap(userTopics, sections, sectionProgresses)

  const continueLearningEntries = userRoadmaps.map((roadmap) => {
    const rId = roadmap._id.toString()
    const latestProgress = latestProgressPerRoadmap.get(rId)
    let currentSection = null
    let currentTopicId = null

    if (latestProgress) {
      currentTopicId = userTopicToMasterTopic.get(latestProgress.userTopicId.toString()) || null
      const sectionDetails = sectionMap.get(latestProgress.sectionId.toString())
      if (sectionDetails) {
        currentSection = {
          sectionId: sectionDetails._id,
          name: sectionDetails.name,
          slug: sectionDetails.slug,
          startedAt: latestProgress.startedAt,
        }
      }
    }

    if (!currentSection) {
      const nextUp = nextUpByRoadmap.get(rId)
      if (nextUp) {
        currentTopicId = nextUp.topicId
        currentSection = {
          sectionId: nextUp.sectionId,
          name: nextUp.name,
          slug: nextUp.slug,
          // Not started yet — this is the derived next step, not a progress row.
          startedAt: null,
        }
      }
    }

    return {
      userRoadmapId: roadmap._id,
      roadmapId: roadmap.roadmapId,
      currentTopicId,
      currentSection,
    }
  })

  // Most recently active roadmap first: the FE card shows the first entry with a
  // currentSection, so ordering by last graded activity resumes where the learner
  // actually left off. Roadmaps without any activity keep their enroll order.
  const lastActivityByRoadmap = new Map<string, number>()
  for (const p of sectionProgresses) {
    const rId = userTopicToRoadmap.get(p.userTopicId.toString())
    if (!rId) continue
    const at = new Date(p.updatedAt ?? p.startedAt).getTime()
    if (at > (lastActivityByRoadmap.get(rId) ?? 0)) lastActivityByRoadmap.set(rId, at)
  }
  const continueLearningList = continueLearningEntries.sort(
    (a, b) =>
      (lastActivityByRoadmap.get(b.userRoadmapId.toString()) ?? 0) -
      (lastActivityByRoadmap.get(a.userRoadmapId.toString()) ?? 0),
  )

  // Sections completed per day this week (Mon→Sun, UTC+7). Drives the dashboard
  // Weekly Progress chart and the real streak activity dots. A shared master topic
  // has one completed-progress row per enrolled roadmap (same sectionId), so dedupe
  // by sectionId to count each finished section once, not once per roadmap.
  const completedAtBySection = new Map<string, Date | null>()
  for (const p of sectionProgresses) {
    if (!p.isCompleted) continue
    const key = p.sectionId.toString()
    if (!completedAtBySection.has(key)) {
      completedAtBySection.set(key, p.completedAt)
      continue
    }
    completedAtBySection.set(
      key,
      keepEarlierCompletion(p.completedAt, completedAtBySection.get(key) ?? null),
    )
  }
  const weeklyProgress = buildWeeklyProgress([...completedAtBySection.values()])

  // "Completed Topics" tile (H5): a topic is done when it has PUBLISHED sections
  // and every one is completed. Counted against published sections only (matching
  // the learner-facing topic view + roadmap graph) so an unpublished draft section
  // can't block completion and stale/removed-section progress can't overcount.
  const publishedSectionIds = new Set(
    sections.filter((s) => s.isPublished).map((s) => s._id.toString()),
  )
  const publishedSectionsByTopic = new Map<string, number>()
  for (const s of sections) {
    if (!s.isPublished) continue
    const tId = s.topicId.toString()
    publishedSectionsByTopic.set(tId, (publishedSectionsByTopic.get(tId) ?? 0) + 1)
  }
  const completedSectionsByUserTopic = new Map<string, number>()
  for (const p of sectionProgresses) {
    if (!p.isCompleted || !publishedSectionIds.has(p.sectionId.toString())) continue
    const id = p.userTopicId.toString()
    completedSectionsByUserTopic.set(id, (completedSectionsByUserTopic.get(id) ?? 0) + 1)
  }
  // Dedupe by master topic: a topic shared across two roadmaps (F18) is one
  // completed topic, not two, even though it has one UserTopic per roadmap.
  const completedMasterTopics = new Set<string>()
  for (const t of userTopics) {
    const total = publishedSectionsByTopic.get(t.topicId.toString()) ?? 0
    const done = completedSectionsByUserTopic.get(t._id.toString()) ?? 0
    if (total > 0 && done >= total) completedMasterTopics.add(t.topicId.toString())
  }
  const completedTopics = completedMasterTopics.size

  // "Quiz Avg" tile (H5): mean of the best score per attempted quiz (0-100),
  // or null when the learner has no submitted attempts yet (FE shows "--").
  const submittedAttempts = await QuizAttempt.find({ userId, submittedAt: { $ne: null } })
    .select('quizId score')
    .lean()
  const bestScoreByQuiz = new Map<string, number>()
  for (const a of submittedAttempts) {
    const id = a.quizId.toString()
    bestScoreByQuiz.set(id, Math.max(bestScoreByQuiz.get(id) ?? 0, a.score ?? 0))
  }
  const quizScores = [...bestScoreByQuiz.values()]
  const quizAvg =
    quizScores.length > 0
      ? Math.round(quizScores.reduce((sum, v) => sum + v, 0) / quizScores.length)
      : null

  return {
    continueLearningList,
    roadmaps: userRoadmaps.map((roadmap) => roadmap.roadmapId),
    availableRolesForAdd,
    streak,
    weeklyProgress,
    stats: {
      progress,
      level: userProfile?.level || SkillLevel.BEGINNER,
      completedTopics,
      quizAvg,
    },
  }
}
