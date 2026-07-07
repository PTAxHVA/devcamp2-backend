import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { connectTestDb, disconnectTestDb, clearCollections } from './helpers/test-db.js'
import { seedRoadmap } from './helpers/fixtures.js'
import { Section } from '../src/models/section.model.js'
import { UserTopic } from '../src/models/user-topic.model.js'
import { UserSectionProgress } from '../src/models/user-section-progress.model.js'

const base = '/api/v1/client'

const register = async (email: string): Promise<string> => {
  const res = await request(app)
    .post(`${base}/auth/signup`)
    .send({ email, password: 'Sup3rPass!', username: email.split('@')[0] })
  return res.body.data.token as string
}

const enroll = async (token: string, roadmapId: string, branchId: string): Promise<string> => {
  const res = await request(app)
    .post(`${base}/roadmaps`)
    .set('Authorization', `Bearer ${token}`)
    .send({ masterRoadmapId: roadmapId, branchSelections: [branchId] })
  return res.body.data._id as string
}

let slug = 0
const addSection = (topicId: string, orderIndex: number, isPublished = true) => {
  slug += 1
  return Section.create({
    topicId,
    name: `Section ${slug}`,
    slug: `sec-${slug}`,
    isPublished,
    orderIndex,
  })
}

const getDashboard = async (token: string) => {
  const res = await request(app).get(`${base}/dashboard`).set('Authorization', `Bearer ${token}`)
  expect(res.status).toBe(200)
  return res.body.data as {
    continueLearningList: Array<{
      userRoadmapId: string
      currentTopicId: string | null
      currentSection: {
        sectionId: string
        name: string
        slug: string
        startedAt: string | null
      } | null
    }>
  }
}

describe('GET /dashboard continue-learning next-up (BN2b)', () => {
  beforeAll(connectTestDb)
  afterAll(disconnectTestDb)
  afterEach(clearCollections)

  it('fresh enroll surfaces the first section of the first topic (startedAt null)', async () => {
    const token = await register('bn2b-fresh@example.com')
    const r = await seedRoadmap('Frontend BN2b-1', ['T1', 'T2'])
    const s1 = await addSection(r.topicIds[0], 0)
    await addSection(r.topicIds[0], 1)
    await addSection(r.topicIds[1], 0)
    await enroll(token, r.roadmapId, r.branchId)

    const data = await getDashboard(token)
    const entry = data.continueLearningList[0]
    expect(entry.currentTopicId).toBe(r.topicIds[0])
    expect(entry.currentSection?.sectionId).toBe(s1._id.toString())
    expect(entry.currentSection?.startedAt).toBeNull()
  })

  it('after completing a section, next-up moves to the following section', async () => {
    const token = await register('bn2b-pass@example.com')
    const r = await seedRoadmap('Frontend BN2b-2', ['T1', 'T2'])
    const s1 = await addSection(r.topicIds[0], 0)
    const s2 = await addSection(r.topicIds[0], 1)
    const userRoadmapId = await enroll(token, r.roadmapId, r.branchId)

    const ut = await UserTopic.findOne({ userRoadmapId, topicId: r.topicIds[0] }).lean()
    await UserSectionProgress.create({
      userTopicId: ut!._id,
      sectionId: s1._id,
      isCompleted: true,
      startedAt: new Date(),
      completedAt: new Date(),
    })

    const data = await getDashboard(token)
    expect(data.continueLearningList[0].currentSection?.sectionId).toBe(s2._id.toString())
  })

  it('an in-progress (failed) row still wins over the derived next-up', async () => {
    const token = await register('bn2b-fail@example.com')
    const r = await seedRoadmap('Frontend BN2b-3', ['T1', 'T2'])
    await addSection(r.topicIds[0], 0)
    const laterSection = await addSection(r.topicIds[1], 0)
    const userRoadmapId = await enroll(token, r.roadmapId, r.branchId)

    // Failed quiz on a LATER topic: the old in-progress path must surface it, not
    // the fallback's first-incomplete section of topic 1.
    const utLater = await UserTopic.findOne({ userRoadmapId, topicId: r.topicIds[1] }).lean()
    await UserSectionProgress.create({
      userTopicId: utLater!._id,
      sectionId: laterSection._id,
      isCompleted: false,
      startedAt: new Date(),
      completedAt: null,
    })

    const data = await getDashboard(token)
    const entry = data.continueLearningList[0]
    expect(entry.currentTopicId).toBe(r.topicIds[1])
    expect(entry.currentSection?.sectionId).toBe(laterSection._id.toString())
    expect(entry.currentSection?.startedAt).not.toBeNull()
  })

  it('a fully completed roadmap keeps currentSection null', async () => {
    const token = await register('bn2b-done@example.com')
    const r = await seedRoadmap('Frontend BN2b-4', ['T1'])
    const s1 = await addSection(r.topicIds[0], 0)
    const userRoadmapId = await enroll(token, r.roadmapId, r.branchId)

    const ut = await UserTopic.findOne({ userRoadmapId }).lean()
    await UserSectionProgress.create({
      userTopicId: ut!._id,
      sectionId: s1._id,
      isCompleted: true,
      startedAt: new Date(),
      completedAt: new Date(),
    })

    const data = await getDashboard(token)
    expect(data.continueLearningList[0].currentSection).toBeNull()
    expect(data.continueLearningList[0].currentTopicId).toBeNull()
  })

  it('topics with only unpublished sections are skipped', async () => {
    const token = await register('bn2b-unpub@example.com')
    const r = await seedRoadmap('Frontend BN2b-5', ['T1', 'T2'])
    await addSection(r.topicIds[0], 0, false)
    const published = await addSection(r.topicIds[1], 0)
    await enroll(token, r.roadmapId, r.branchId)

    const data = await getDashboard(token)
    const entry = data.continueLearningList[0]
    expect(entry.currentTopicId).toBe(r.topicIds[1])
    expect(entry.currentSection?.sectionId).toBe(published._id.toString())
  })

  it('the most recently active roadmap comes first in continueLearningList', async () => {
    const token = await register('bn2b-two@example.com')
    const r1 = await seedRoadmap('Frontend BN2b-6', ['T1'])
    const r2 = await seedRoadmap('Backend BN2b-6', ['T1'])
    const r1s = await addSection(r1.topicIds[0], 0)
    await addSection(r1.topicIds[0], 1)
    const r2s = await addSection(r2.topicIds[0], 0)
    await addSection(r2.topicIds[0], 1)
    const ur1 = await enroll(token, r1.roadmapId, r1.branchId)
    const ur2 = await enroll(token, r2.roadmapId, r2.branchId)

    const ut1 = await UserTopic.findOne({ userRoadmapId: ur1 }).lean()
    const ut2 = await UserTopic.findOne({ userRoadmapId: ur2 }).lean()
    await UserSectionProgress.create({
      userTopicId: ut1!._id,
      sectionId: r1s._id,
      isCompleted: true,
      startedAt: new Date(),
      completedAt: new Date(),
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    await UserSectionProgress.create({
      userTopicId: ut2!._id,
      sectionId: r2s._id,
      isCompleted: true,
      startedAt: new Date(),
      completedAt: new Date(),
    })

    const data = await getDashboard(token)
    expect(data.continueLearningList[0].userRoadmapId).toBe(ur2)
    expect(data.continueLearningList[1].userRoadmapId).toBe(ur1)
  })
})
