import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { Types } from 'mongoose'
import { connectTestDb, disconnectTestDb, clearCollections } from './helpers/test-db.js'
import { UserRoadmap } from '../src/models/user-roadmap.model.js'
import { UserTopic } from '../src/models/user-topic.model.js'
import { UserSectionProgress } from '../src/models/user-section-progress.model.js'
import { RoadmapSource } from '../src/types/enums.js'
import { backfillAllSharedTopicProgress } from '../src/services/backfill-shared-topic-progress.service.js'

const STARTED_AT = new Date('2026-06-01T02:00:00.000Z')
const COMPLETED_AT = new Date('2026-06-01T03:00:00.000Z')

// A learner enrolled in two active roadmaps that share one master topic. Only the FE
// roadmap's UserTopic has the shared section completed (a pre-#50 pass); BE is stale.
const seedSharedTopic = async () => {
  const userId = new Types.ObjectId()
  const topicId = new Types.ObjectId()
  const sectionId = new Types.ObjectId()

  const feRoadmap = await UserRoadmap.create({
    userId,
    roadmapId: new Types.ObjectId(),
    sourceType: RoadmapSource.SUGGESTED,
    isActive: true,
  })
  const beRoadmap = await UserRoadmap.create({
    userId,
    roadmapId: new Types.ObjectId(),
    sourceType: RoadmapSource.SUGGESTED,
    isActive: true,
  })

  const feTopic = await UserTopic.create({ userRoadmapId: feRoadmap._id, topicId, orderIndex: 0 })
  const beTopic = await UserTopic.create({ userRoadmapId: beRoadmap._id, topicId, orderIndex: 0 })

  return { userId, sectionId, feTopic, beTopic }
}

describe('backfillAllSharedTopicProgress (BE1 topic-desync backfill)', () => {
  beforeAll(connectTestDb)
  afterAll(disconnectTestDb)
  afterEach(clearCollections)

  it('inserts the missing sibling row, copying the source completedAt (never now)', async () => {
    const { sectionId, feTopic, beTopic } = await seedSharedTopic()
    await UserSectionProgress.create({
      userTopicId: feTopic._id,
      sectionId,
      isCompleted: true,
      startedAt: STARTED_AT,
      completedAt: COMPLETED_AT,
    })

    const stats = await backfillAllSharedTopicProgress({ dryRun: false })

    expect(stats.sharedTopicGroups).toBe(1)
    expect(stats.rowsInserted).toBe(1)
    expect(stats.rowsUpdated).toBe(0)

    const beRow = await UserSectionProgress.findOne({ userTopicId: beTopic._id, sectionId }).lean()
    expect(beRow?.isCompleted).toBe(true)
    // Critical: the historical completion date, NOT a fresh Date.now() (streak fidelity).
    expect(beRow?.completedAt?.toISOString()).toBe(COMPLETED_AT.toISOString())
    expect(beRow?.startedAt.toISOString()).toBe(STARTED_AT.toISOString())
  })

  it('upgrades a stale not-completed sibling row, keeping its own startedAt', async () => {
    const { sectionId, feTopic, beTopic } = await seedSharedTopic()
    await UserSectionProgress.create({
      userTopicId: feTopic._id,
      sectionId,
      isCompleted: true,
      startedAt: STARTED_AT,
      completedAt: COMPLETED_AT,
    })
    const beStarted = new Date('2026-06-02T00:00:00.000Z')
    await UserSectionProgress.create({
      userTopicId: beTopic._id,
      sectionId,
      isCompleted: false,
      startedAt: beStarted,
      completedAt: null,
    })

    const stats = await backfillAllSharedTopicProgress({ dryRun: false })

    expect(stats.rowsInserted).toBe(0)
    expect(stats.rowsUpdated).toBe(1)

    const beRow = await UserSectionProgress.findOne({ userTopicId: beTopic._id, sectionId }).lean()
    expect(beRow?.isCompleted).toBe(true)
    expect(beRow?.completedAt?.toISOString()).toBe(COMPLETED_AT.toISOString())
    // Only completion is propagated; the row keeps its own startedAt.
    expect(beRow?.startedAt.toISOString()).toBe(beStarted.toISOString())
  })

  it('is idempotent — a second run changes nothing', async () => {
    const { sectionId, feTopic } = await seedSharedTopic()
    await UserSectionProgress.create({
      userTopicId: feTopic._id,
      sectionId,
      isCompleted: true,
      startedAt: STARTED_AT,
      completedAt: COMPLETED_AT,
    })

    await backfillAllSharedTopicProgress({ dryRun: false })
    const second = await backfillAllSharedTopicProgress({ dryRun: false })

    expect(second.rowsInserted).toBe(0)
    expect(second.rowsUpdated).toBe(0)
    expect(second.rowsAlreadyInSync).toBeGreaterThan(0)
  })

  it('dry-run reports would-be changes but writes nothing', async () => {
    const { sectionId, feTopic, beTopic } = await seedSharedTopic()
    await UserSectionProgress.create({
      userTopicId: feTopic._id,
      sectionId,
      isCompleted: true,
      startedAt: STARTED_AT,
      completedAt: COMPLETED_AT,
    })

    const stats = await backfillAllSharedTopicProgress({ dryRun: true })

    expect(stats.rowsInserted).toBe(1)
    const beRow = await UserSectionProgress.findOne({ userTopicId: beTopic._id, sectionId }).lean()
    expect(beRow).toBeNull()
  })

  it('leaves a non-shared topic (single UserTopic) untouched', async () => {
    const userId = new Types.ObjectId()
    const topicId = new Types.ObjectId()
    const sectionId = new Types.ObjectId()
    const roadmap = await UserRoadmap.create({
      userId,
      roadmapId: new Types.ObjectId(),
      sourceType: RoadmapSource.SUGGESTED,
      isActive: true,
    })
    const topic = await UserTopic.create({ userRoadmapId: roadmap._id, topicId, orderIndex: 0 })
    await UserSectionProgress.create({
      userTopicId: topic._id,
      sectionId,
      isCompleted: true,
      startedAt: STARTED_AT,
      completedAt: COMPLETED_AT,
    })

    const stats = await backfillAllSharedTopicProgress({ dryRun: false })

    expect(stats.sharedTopicGroups).toBe(0)
    expect(stats.rowsInserted).toBe(0)
    expect(await UserSectionProgress.countDocuments()).toBe(1)
  })
})
