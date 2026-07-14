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
})
