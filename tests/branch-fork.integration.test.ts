import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { connectTestDb, disconnectTestDb, clearCollections } from './helpers/test-db.js'
import { seedForkRoadmap } from './helpers/fixtures.js'
import { UserTopic } from '../src/models/user-topic.model.js'
import { TopicStatus } from '../src/types/enums.js'

const base = '/api/v1/client'

const register = async (email: string): Promise<string> => {
  const res = await request(app)
    .post(`${base}/auth/signup`)
    .send({ email, password: 'Sup3rPass!', username: email.split('@')[0] })
  return res.body.data.token as string
}

const enroll = (token: string, roadmapId: string, branchIds: string[]) =>
  request(app)
    .post(`${base}/roadmaps`)
    .set('Authorization', `Bearer ${token}`)
    .send({ masterRoadmapId: roadmapId, branchSelections: branchIds })

const detail = (token: string, id: string) =>
  request(app).get(`${base}/roadmaps/${id}`).set('Authorization', `Bearer ${token}`)

const patch = (token: string, id: string, body: Record<string, unknown>) =>
  request(app).patch(`${base}/roadmaps/${id}`).set('Authorization', `Bearer ${token}`).send(body)

/** Enrolled topic ids in roadmap order (the graph's orderIndex). */
const orderedTopicIds = (res: request.Response): string[] =>
  [...(res.body.data.topics as { masterTopicId: string; orderIndex: number }[])]
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((t) => t.masterTopicId)

describe('branch fork (integration)', () => {
  beforeAll(connectTestDb)
  afterAll(disconnectTestDb)
  afterEach(clearCollections)

  it('exposes fork metadata + ordered topicIds on the public master-roadmap detail', async () => {
    const f = await seedForkRoadmap('Fork Meta')

    const res = await request(app).get(`${base}/master-roadmaps/${f.roadmapId}`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    const branches = res.body.data.branches as {
      _id: string
      selectionGroup: string | null
      isMutuallyExclusive: boolean
      isMandatory: boolean
      topicCount: number
      topicIds: string[]
    }[]
    expect(branches).toHaveLength(3)

    const core = branches.find((b) => b._id === f.coreBranchId)!
    const mongo = branches.find((b) => b._id === f.mongoBranchId)!
    const pg = branches.find((b) => b._id === f.pgBranchId)!

    expect(core.selectionGroup).toBeNull()
    expect(core.isMandatory).toBe(true)
    expect(core.topicIds).toEqual([f.basicsTopicId, f.serverTopicId, f.tailTopicId])

    for (const branch of [mongo, pg]) {
      expect(branch.selectionGroup).toBe('Database')
      expect(branch.isMutuallyExclusive).toBe(true)
      expect(branch.isMandatory).toBe(false)
      expect(branch.topicCount).toBe(1)
    }
    expect(mongo.topicIds).toEqual([f.mongoTopicId])
    expect(pg.topicIds).toEqual([f.pgTopicId])
  })

  it('rejects enrolling two branches of one exclusive group with BRANCH_GROUP_CONFLICT', async () => {
    const f = await seedForkRoadmap('Fork Conflict')
    const token = await register('fork-conflict@example.com')

    const res = await enroll(token, f.roadmapId, [f.coreBranchId, f.mongoBranchId, f.pgBranchId])
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(res.body.error.code).toBe('BRANCH_GROUP_CONFLICT')
    expect(res.body.error.details.selectionGroup).toBe('Database')
    expect(res.body.error.details.branchIds).toEqual(
      expect.arrayContaining([f.mongoBranchId, f.pgBranchId]),
    )
  })

  it('enrolls core + one fork branch into the composed order', async () => {
    const f = await seedForkRoadmap('Fork Compose')

    const mongoToken = await register('fork-mongo@example.com')
    const mongoEnroll = await enroll(mongoToken, f.roadmapId, [f.coreBranchId, f.mongoBranchId])
    expect(mongoEnroll.status).toBe(201)
    expect(mongoEnroll.body.data.topicCount).toBe(4)
    const mongoDetail = await detail(mongoToken, mongoEnroll.body.data._id as string)
    expect(orderedTopicIds(mongoDetail)).toEqual([
      f.basicsTopicId,
      f.serverTopicId,
      f.mongoTopicId,
      f.tailTopicId,
    ])

    const pgToken = await register('fork-pg@example.com')
    const pgEnroll = await enroll(pgToken, f.roadmapId, [f.coreBranchId, f.pgBranchId])
    expect(pgEnroll.status).toBe(201)
    const pgDetail = await detail(pgToken, pgEnroll.body.data._id as string)
    expect(orderedTopicIds(pgDetail)).toEqual([
      f.basicsTopicId,
      f.serverTopicId,
      f.pgTopicId,
      f.tailTopicId,
    ])
  })

  it('still allows a fork-only enrollment at the API level (documented behaviour)', async () => {
    // The FE never produces this (the core branch renders as mandatory), but the
    // API stays permissive by design — a selection of one exclusive branch alone
    // violates no group rule.
    const f = await seedForkRoadmap('Fork Only')
    const token = await register('fork-only@example.com')

    const res = await enroll(token, f.roadmapId, [f.mongoBranchId])
    expect(res.status).toBe(201)
    expect(res.body.data.topicCount).toBe(1)
  })

  it('rejects an AI suggest request that mixes exclusive branches', async () => {
    const f = await seedForkRoadmap('Fork Suggest')
    const token = await register('fork-suggest@example.com')

    const res = await request(app)
      .post(`${base}/ai/roadmap-suggest`)
      .set('Authorization', `Bearer ${token}`)
      .send({ masterRoadmapId: f.roadmapId, branchSelections: [f.mongoBranchId, f.pgBranchId] })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('BRANCH_GROUP_CONFLICT')
  })

  it('swaps the database path via one PATCH and flips sourceType to CUSTOMIZED', async () => {
    const f = await seedForkRoadmap('Fork Swap')
    const token = await register('fork-swap@example.com')
    const enrolled = await enroll(token, f.roadmapId, [f.coreBranchId, f.mongoBranchId])
    const id = enrolled.body.data._id as string

    const res = await patch(token, id, {
      addTopicIds: [f.pgTopicId],
      removeTopicIds: [f.mongoTopicId],
    })
    expect(res.status).toBe(200)

    const after = await detail(token, id)
    expect(orderedTopicIds(after)).toEqual([
      f.basicsTopicId,
      f.serverTopicId,
      f.pgTopicId,
      f.tailTopicId,
    ])
    expect(after.body.data.roadmap.sourceType).toBe('CUSTOMIZED')
  })

  it('blocks the swap when the outgoing fork topic has progress (remove-gate intact)', async () => {
    const f = await seedForkRoadmap('Fork Gate')
    const token = await register('fork-gate@example.com')
    const enrolled = await enroll(token, f.roadmapId, [f.coreBranchId, f.mongoBranchId])
    const id = enrolled.body.data._id as string

    await UserTopic.updateOne(
      { userRoadmapId: id, topicId: f.mongoTopicId },
      { $set: { status: TopicStatus.IN_PROGRESS } },
    )

    const res = await patch(token, id, {
      addTopicIds: [f.pgTopicId],
      removeTopicIds: [f.mongoTopicId],
    })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('TOPIC_NOT_REMOVABLE')
    expect(res.body.error.details.topicIds).toEqual([f.mongoTopicId])
  })

  it('requires authentication to enroll', async () => {
    const f = await seedForkRoadmap('Fork Auth')
    const res = await request(app)
      .post(`${base}/roadmaps`)
      .send({ masterRoadmapId: f.roadmapId, branchSelections: [f.coreBranchId] })
    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
  })
})
