import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { Types } from 'mongoose'
import { connectTestDb, disconnectTestDb, clearCollections } from './helpers/test-db.js'
import { User } from '../src/models/user.model.js'
import { UserRoadmap } from '../src/models/user-roadmap.model.js'
import { UserTopic } from '../src/models/user-topic.model.js'
import { Section } from '../src/models/section.model.js'
import { UserSectionProgress } from '../src/models/user-section-progress.model.js'
import { RoadmapSource } from '../src/types/enums.js'
import { buildRoadmapGraph, type GraphTopicInput } from '../src/services/roadmap-graph.js'
import { completeRoadmapForDemo } from '../src/services/complete-roadmap-for-demo.service.js'
import { UserProfile } from '../src/models/user-profile.model.js'
import { Quiz } from '../src/models/quiz.model.js'
import { QuizAttempt } from '../src/models/quiz-attempt.model.js'
import { getDayNumberUTC7 } from '../src/utils/streak.util.js'

const EMAIL = 'demo@vora.dev'

interface SeedOptions {
  topics?: number
  publishedPerTopic?: number
  unpublishedPerTopic?: number
  roadmapActive?: boolean
  userActive?: boolean
}

interface SeededTopic {
  topicId: Types.ObjectId
  userTopicId: Types.ObjectId
  publishedSectionIds: Types.ObjectId[]
}

/**
 * A demo account with one roadmap of N topics, each with some published (+ optionally
 * unpublished) sections. Returns the userTopic ids + published section ids per topic.
 */
const seedAccount = async (opts: SeedOptions = {}) => {
  const topics = opts.topics ?? 2
  const pub = opts.publishedPerTopic ?? 2
  const unpub = opts.unpublishedPerTopic ?? 0

  const user = await User.create({
    username: 'demo',
    email: EMAIL,
    passwordHash: 'x',
    isActive: opts.userActive ?? true,
  })
  const roadmap = await UserRoadmap.create({
    userId: user._id,
    roadmapId: new Types.ObjectId(),
    sourceType: RoadmapSource.SUGGESTED,
    isActive: opts.roadmapActive ?? true,
  })

  const seeded: SeededTopic[] = []
  for (let i = 0; i < topics; i++) {
    const topicId = new Types.ObjectId()
    const ut = await UserTopic.create({ userRoadmapId: roadmap._id, topicId, orderIndex: i })
    const publishedSectionIds: Types.ObjectId[] = []
    for (let s = 0; s < pub; s++) {
      const sec = await Section.create({
        topicId,
        name: `T${i}S${s}`,
        slug: `t${i}-s${s}`,
        isPublished: true,
      })
      publishedSectionIds.push(sec._id)
    }
    for (let s = 0; s < unpub; s++) {
      await Section.create({ topicId, name: `T${i}U${s}`, slug: `t${i}-u${s}`, isPublished: false })
    }
    seeded.push({ topicId, userTopicId: ut._id, publishedSectionIds })
  }
  return { user, roadmap, topics: seeded }
}

describe('completeRoadmapForDemo (demo account 100%-complete helper)', () => {
  beforeAll(connectTestDb)
  afterAll(disconnectTestDb)
  afterEach(clearCollections)

  it('marks every published section of every topic completed and reports fullyComplete', async () => {
    const { topics } = await seedAccount({ topics: 2, publishedPerTopic: 2 })

    const stats = await completeRoadmapForDemo({ email: EMAIL, dryRun: false })

    expect(stats.userFound).toBe(true)
    expect(stats.userActive).toBe(true)
    expect(stats.roadmapsProcessed).toBe(1)
    expect(stats.topicsProcessed).toBe(2)
    expect(stats.sectionsTargeted).toBe(4)
    expect(stats.rowsInserted).toBe(4)
    expect(stats.fullyComplete).toBe(true)

    // Exactly the published section ids are completed for each user-topic.
    for (const t of topics) {
      const rows = await UserSectionProgress.find({ userTopicId: t.userTopicId }).lean()
      const completedIds = rows
        .filter((r) => r.isCompleted)
        .map((r) => r.sectionId.toString())
        .sort()
      expect(completedIds).toEqual(t.publishedSectionIds.map((id) => id.toString()).sort())
    }
  })

  it('the real roadmap graph then marks every topic "completed" (the certificate gate)', async () => {
    const { topics } = await seedAccount({ topics: 2, publishedPerTopic: 3 })
    await completeRoadmapForDemo({ email: EMAIL, dryRun: false })

    // Feed post-run DB state into the SAME pure builder the FE roadmap/certificate use.
    const inputs: GraphTopicInput[] = []
    for (const t of topics) {
      const sectionTotal = t.publishedSectionIds.length
      const sectionCompleted = await UserSectionProgress.countDocuments({
        userTopicId: t.userTopicId,
        sectionId: { $in: t.publishedSectionIds },
        isCompleted: true,
      })
      inputs.push({
        masterTopicId: t.topicId.toString(),
        userTopicId: t.userTopicId.toString(),
        name: 'T',
        descriptionShort: '',
        orderIndex: 0,
        estimatedHours: 0,
        prerequisiteTopicIds: [],
        rawStatus: null,
        sectionTotal,
        sectionCompleted,
      })
    }

    const graph = buildRoadmapGraph(inputs)
    expect(graph.topics).toHaveLength(2)
    expect(graph.topics.every((t) => t.status === 'completed')).toBe(true)
  })

  it('only completes PUBLISHED sections (unpublished never count toward "completed")', async () => {
    const { topics } = await seedAccount({
      topics: 1,
      publishedPerTopic: 1,
      unpublishedPerTopic: 2,
    })

    const stats = await completeRoadmapForDemo({ email: EMAIL, dryRun: false })

    expect(stats.sectionsTargeted).toBe(1)
    expect(stats.rowsInserted).toBe(1)
    expect(stats.fullyComplete).toBe(true)
    // The single completed row targets the published section, not an unpublished one.
    const rows = await UserSectionProgress.find({ userTopicId: topics[0]!.userTopicId }).lean()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.sectionId.toString()).toBe(topics[0]!.publishedSectionIds[0]!.toString())
  })

  it('completes each roadmap of a topic SHARED across two roadmaps', async () => {
    const user = await User.create({ username: 'demo', email: EMAIL, passwordHash: 'x' })
    const topicId = new Types.ObjectId()
    const sectionA = await Section.create({ topicId, name: 'A', slug: 'a', isPublished: true })
    const sectionB = await Section.create({ topicId, name: 'B', slug: 'b', isPublished: true })
    const roadmaps = await Promise.all([
      UserRoadmap.create({
        userId: user._id,
        roadmapId: new Types.ObjectId(),
        sourceType: RoadmapSource.SUGGESTED,
        isActive: true,
      }),
      UserRoadmap.create({
        userId: user._id,
        roadmapId: new Types.ObjectId(),
        sourceType: RoadmapSource.SUGGESTED,
        isActive: true,
      }),
    ])
    const userTopics = await Promise.all(
      roadmaps.map((r) => UserTopic.create({ userRoadmapId: r._id, topicId, orderIndex: 0 })),
    )

    const stats = await completeRoadmapForDemo({ email: EMAIL, dryRun: false })

    expect(stats.roadmapsProcessed).toBe(2)
    expect(stats.topicsProcessed).toBe(2)
    expect(stats.rowsInserted).toBe(4) // 2 user-topics × 2 sections
    expect(stats.fullyComplete).toBe(true)
    for (const ut of userTopics) {
      const done = await UserSectionProgress.countDocuments({
        userTopicId: ut._id,
        sectionId: { $in: [sectionA._id, sectionB._id] },
        isCompleted: true,
      })
      expect(done).toBe(2)
    }
  })

  it('is idempotent — a second run changes nothing, including timestamps', async () => {
    await seedAccount({ topics: 1, publishedPerTopic: 2 })

    await completeRoadmapForDemo({ email: EMAIL, dryRun: false })
    const before = await UserSectionProgress.find().sort({ sectionId: 1 }).lean()
    const second = await completeRoadmapForDemo({ email: EMAIL, dryRun: false })
    const after = await UserSectionProgress.find().sort({ sectionId: 1 }).lean()

    expect(second.rowsInserted).toBe(0)
    expect(second.rowsUpgraded).toBe(0)
    expect(second.rowsAlreadyComplete).toBe(2)
    expect(after.map((r) => r.completedAt?.toISOString())).toEqual(
      before.map((r) => r.completedAt?.toISOString()),
    )
  })

  it('upgrades a stale not-completed row and stamps its completedAt', async () => {
    const { topics } = await seedAccount({ topics: 1, publishedPerTopic: 1 })
    await UserSectionProgress.create({
      userTopicId: topics[0]!.userTopicId,
      sectionId: topics[0]!.publishedSectionIds[0]!,
      isCompleted: false,
      startedAt: new Date('2026-06-01T00:00:00.000Z'),
      completedAt: null,
    })

    const stats = await completeRoadmapForDemo({ email: EMAIL, dryRun: false })

    expect(stats.rowsInserted).toBe(0)
    expect(stats.rowsUpgraded).toBe(1)
    const row = await UserSectionProgress.findOne({
      userTopicId: topics[0]!.userTopicId,
      sectionId: topics[0]!.publishedSectionIds[0]!,
    }).lean()
    expect(row?.isCompleted).toBe(true)
    expect(row?.completedAt).not.toBeNull()
  })

  it('dry-run reports the would-be 100% but writes nothing', async () => {
    await seedAccount({ topics: 1, publishedPerTopic: 2 })

    const stats = await completeRoadmapForDemo({ email: EMAIL, dryRun: true })

    expect(stats.rowsInserted).toBe(2)
    expect(stats.fullyComplete).toBe(true)
    expect(await UserSectionProgress.countDocuments()).toBe(0)
  })

  it('is case-insensitive on the email; reports userFound=false for an unknown account', async () => {
    await seedAccount({ topics: 1, publishedPerTopic: 1 })

    const upper = await completeRoadmapForDemo({ email: 'DEMO@VORA.DEV', dryRun: false })
    expect(upper.userFound).toBe(true)
    expect(upper.rowsInserted).toBe(1)

    const missing = await completeRoadmapForDemo({ email: 'nobody@vora.dev', dryRun: false })
    expect(missing.userFound).toBe(false)
    expect(missing.fullyComplete).toBe(false)
  })

  it('flags a topic with no published sections and is NOT fullyComplete', async () => {
    await seedAccount({ topics: 1, publishedPerTopic: 0, unpublishedPerTopic: 2 })

    const stats = await completeRoadmapForDemo({ email: EMAIL, dryRun: false })

    expect(stats.topicsWithoutSections).toBe(1)
    expect(stats.rowsInserted).toBe(0)
    expect(stats.fullyComplete).toBe(false)
    expect(await UserSectionProgress.countDocuments()).toBe(0)
  })

  it('leaves an inactive (soft-deleted) roadmap untouched and is NOT fullyComplete', async () => {
    await seedAccount({ topics: 1, publishedPerTopic: 2, roadmapActive: false })

    const stats = await completeRoadmapForDemo({ email: EMAIL, dryRun: false })

    expect(stats.roadmapsProcessed).toBe(0)
    expect(stats.fullyComplete).toBe(false)
    expect(await UserSectionProgress.countDocuments()).toBe(0)
  })

  it('still completes a deactivated account but reports userActive=false', async () => {
    await seedAccount({ topics: 1, publishedPerTopic: 2, userActive: false })

    const stats = await completeRoadmapForDemo({ email: EMAIL, dryRun: false })

    expect(stats.userFound).toBe(true)
    expect(stats.userActive).toBe(false)
    expect(stats.rowsInserted).toBe(2)
    expect(stats.fullyComplete).toBe(true)
  })

  it('is NOT fullyComplete when a second active roadmap is empty (per-roadmap check)', async () => {
    // Roadmap A completes fully; roadmap B is active but has no topics. The account is
    // not 100% (B still fails the certificate gate), so fullyComplete must be false even
    // though the aggregate topic count is > 0 and no processed topic lacked sections.
    const { user } = await seedAccount({ topics: 1, publishedPerTopic: 2 })
    await UserRoadmap.create({
      userId: user._id,
      roadmapId: new Types.ObjectId(),
      sourceType: RoadmapSource.SUGGESTED,
      isActive: true,
    })

    const stats = await completeRoadmapForDemo({ email: EMAIL, dryRun: false })

    expect(stats.roadmapsProcessed).toBe(2)
    expect(stats.topicsProcessed).toBe(1)
    expect(stats.topicsWithoutSections).toBe(0)
    expect(stats.fullyComplete).toBe(false)
  })

  // ---- demo "show" polish: --streak-days (spread + counters) and --quiz-scores ----

  it('streakDays spreads completedAt across N UTC+7 days ending today and sets the streak counters', async () => {
    // 3 topics × 3 sections = 9 unique sections, spread across 5 days.
    await seedAccount({ topics: 3, publishedPerTopic: 3 })

    const stats = await completeRoadmapForDemo({ email: EMAIL, dryRun: false, streakDays: 5 })

    expect(stats.streakDaysApplied).toBe(5)
    expect(stats.profileUpdated).toBe(true)
    expect(stats.rowsInserted).toBe(9)

    const today = getDayNumberUTC7(new Date())
    const rows = await UserSectionProgress.find({ isCompleted: true }).lean()
    expect(rows).toHaveLength(9)
    const buckets = new Set(rows.map((r) => getDayNumberUTC7(new Date(r.completedAt!))))
    expect(buckets.size).toBe(5) // one distinct day per offset 0..4
    expect(Math.max(...buckets)).toBe(today) // today is covered (offset 0)
    expect(Math.min(...buckets)).toBe(today - 4) // oldest day is exactly N-1 back

    const profile = await UserProfile.findOne({}).lean()
    expect(profile?.streak).toBe(5)
    expect(profile?.longestStreak).toBe(5)
    expect(getDayNumberUTC7(new Date(profile!.lastActivityDate!))).toBe(today)
  })

  it('caps streakDays at the number of unique sections', async () => {
    // Only 2 sections but 10 days requested → the effective streak is 2.
    await seedAccount({ topics: 1, publishedPerTopic: 2 })

    const stats = await completeRoadmapForDemo({ email: EMAIL, dryRun: false, streakDays: 10 })

    expect(stats.streakDaysApplied).toBe(2)
    const profile = await UserProfile.findOne({}).lean()
    expect(profile?.streak).toBe(2)
    const buckets = new Set(
      (await UserSectionProgress.find({ isCompleted: true }).lean()).map((r) =>
        getDayNumberUTC7(new Date(r.completedAt!)),
      ),
    )
    expect(buckets.size).toBe(2)
  })

  it('quizScores writes one passed attempt per completed section quiz', async () => {
    const { topics } = await seedAccount({ topics: 2, publishedPerTopic: 2 })
    const sectionIds = topics.flatMap((t) => t.publishedSectionIds)
    await Quiz.insertMany(sectionIds.map((sectionId) => ({ sectionId, minPassScore: 80 })))

    const stats = await completeRoadmapForDemo({ email: EMAIL, dryRun: false, quizScores: true })

    expect(stats.quizAttemptsWritten).toBe(4)
    const attempts = await QuizAttempt.find({}).lean()
    expect(attempts).toHaveLength(4)
    expect(attempts.every((a) => a.isPassed === true)).toBe(true)
    expect(attempts.every((a) => a.submittedAt !== null)).toBe(true)
    expect(attempts.every((a) => (a.score ?? 0) >= 80)).toBe(true)
  })

  it('quizScores dry-run counts attempts but writes none', async () => {
    const { topics } = await seedAccount({ topics: 1, publishedPerTopic: 2 })
    await Quiz.insertMany(
      topics[0]!.publishedSectionIds.map((sectionId) => ({ sectionId, minPassScore: 80 })),
    )

    const stats = await completeRoadmapForDemo({ email: EMAIL, dryRun: true, quizScores: true })

    expect(stats.quizAttemptsWritten).toBe(2)
    expect(await QuizAttempt.countDocuments()).toBe(0)
    expect(await UserSectionProgress.countDocuments()).toBe(0)
  })

  it('streak mode re-dates an existing row without leaving completedAt before startedAt', async () => {
    const { topics } = await seedAccount({ topics: 1, publishedPerTopic: 2 })
    // Already completed "today" — the spread must move its WHOLE timeline back, not just
    // completedAt (which would leave completedAt earlier than startedAt).
    await UserSectionProgress.create({
      userTopicId: topics[0]!.userTopicId,
      sectionId: topics[0]!.publishedSectionIds[0]!,
      isCompleted: true,
      startedAt: new Date(),
      completedAt: new Date(),
    })

    const stats = await completeRoadmapForDemo({ email: EMAIL, dryRun: false, streakDays: 2 })

    expect(stats.rowsRestamped).toBe(1)
    expect(stats.rowsInserted).toBe(1)
    const rows = await UserSectionProgress.find({ isCompleted: true }).lean()
    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(r.completedAt!.getTime()).toBeGreaterThanOrEqual(r.startedAt.getTime())
    }
  })

  it('writes no UserProfile streak and no quiz attempts when neither option is set', async () => {
    await seedAccount({ topics: 1, publishedPerTopic: 2 })

    const stats = await completeRoadmapForDemo({ email: EMAIL, dryRun: false })

    expect(stats.streakDaysApplied).toBe(0)
    expect(stats.profileUpdated).toBe(false)
    expect(stats.quizAttemptsWritten).toBe(0)
    expect(stats.rowsRestamped).toBe(0)
    expect(await UserProfile.countDocuments()).toBe(0)
    expect(await QuizAttempt.countDocuments()).toBe(0)
  })
})
