import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import request from 'supertest'
import mongoose from 'mongoose'
import app from '../src/app.js'
import { connectTestDb, disconnectTestDb, clearCollections } from './helpers/test-db.js'
import { seedRoadmap } from './helpers/fixtures.js'
import { UserTopic } from '../src/models/user-topic.model.js'
import { UserSectionProgress } from '../src/models/user-section-progress.model.js'

const base = '/api/v1/client'

const register = async (email: string): Promise<string> => {
  const res = await request(app)
    .post(`${base}/auth/signup`)
    .send({ email, password: 'Sup3rPass!', username: email.split('@')[0] })
  return res.body.data.token as string
}

const enroll = (token: string, roadmapId: string, branchId: string) =>
  request(app)
    .post(`${base}/roadmaps`)
    .set('Authorization', `Bearer ${token}`)
    .send({ masterRoadmapId: roadmapId, branchSelections: [branchId] })

const firstUserTopicId = async (userRoadmapId: string): Promise<mongoose.Types.ObjectId> => {
  const ut = await UserTopic.findOne({ userRoadmapId }).select('_id').lean()
  return ut!._id
}

const complete = (
  userTopicId: mongoose.Types.ObjectId,
  completedAt: Date,
  sectionId = new mongoose.Types.ObjectId(),
) =>
  UserSectionProgress.create({
    userTopicId,
    sectionId,
    isCompleted: true,
    startedAt: completedAt,
    completedAt,
  })

const daysAgo = (n: number): Date => new Date(Date.now() - n * 86_400_000)
const sumCounts = (series: { count: number }[]): number => series.reduce((s, p) => s + p.count, 0)

describe('GET /me/activity', () => {
  beforeAll(connectTestDb)
  afterAll(disconnectTestDb)
  afterEach(clearCollections)

  it('returns a 30-day series with per-day counts + a pre-window baseline', async () => {
    const token = await register('act1@example.com')
    const r = await seedRoadmap('Frontend Act')
    const e = await enroll(token, r.roadmapId, r.branchId)
    const userTopicId = await firstUserTopicId(e.body.data._id)

    await complete(userTopicId, new Date()) // today
    await complete(userTopicId, new Date()) // today
    await complete(userTopicId, daysAgo(5)) // in-window
    await complete(userTopicId, daysAgo(40)) // before the window → baseline

    const res = await request(app)
      .get(`${base}/me/activity?days=30`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.days).toBe(30)
    expect(res.body.data.series).toHaveLength(30)
    expect(res.body.data.baseline).toBe(1)
    // Boundary-robust: 3 in-window completions, busiest single day = the 2 today.
    expect(sumCounts(res.body.data.series)).toBe(3)
    expect(Math.max(...(res.body.data.series as { count: number }[]).map((p) => p.count))).toBe(2)
  })

  it('counts a section shared across two roadmaps once (dedupe by sectionId)', async () => {
    const token = await register('act2@example.com')
    const r1 = await seedRoadmap('FE Act2')
    const r2 = await seedRoadmap('BE Act2')
    const e1 = await enroll(token, r1.roadmapId, r1.branchId)
    const e2 = await enroll(token, r2.roadmapId, r2.branchId)
    const ut1 = await firstUserTopicId(e1.body.data._id)
    const ut2 = await firstUserTopicId(e2.body.data._id)

    const shared = new mongoose.Types.ObjectId()
    const now = new Date()
    await complete(ut1, now, shared)
    await complete(ut2, now, shared)

    const res = await request(app)
      .get(`${base}/me/activity?days=30`)
      .set('Authorization', `Bearer ${token}`)
    expect(sumCounts(res.body.data.series)).toBe(1)
    expect(res.body.data.baseline).toBe(0)
  })

  it('returns an all-zero series + baseline 0 for a learner with no completions', async () => {
    const token = await register('act3@example.com')
    const res = await request(app)
      .get(`${base}/me/activity`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.days).toBe(30)
    expect(res.body.data.baseline).toBe(0)
    expect((res.body.data.series as { count: number }[]).every((p) => p.count === 0)).toBe(true)
  })

  it('keeps the earliest completion for a shared section (deterministic bucket)', async () => {
    const token = await register('act5@example.com')
    const r1 = await seedRoadmap('FE Act5')
    const r2 = await seedRoadmap('BE Act5')
    const e1 = await enroll(token, r1.roadmapId, r1.branchId)
    const e2 = await enroll(token, r2.roadmapId, r2.branchId)
    const ut1 = await firstUserTopicId(e1.body.data._id)
    const ut2 = await firstUserTopicId(e2.body.data._id)

    const shared = new mongoose.Types.ObjectId()
    // Same section, two roadmaps, DIFFERENT dates: today vs 40 days ago. Earliest wins
    // → the completion lands in the pre-window baseline, not today's bucket.
    await complete(ut1, new Date(), shared)
    await complete(ut2, daysAgo(40), shared)

    const res = await request(app)
      .get(`${base}/me/activity?days=30`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.body.data.baseline).toBe(1)
    expect(sumCounts(res.body.data.series)).toBe(0)
  })

  it('clamps + integer-coerces the days window (no 500 on junk input)', async () => {
    const token = await register('act4@example.com')
    const call = (q: string) =>
      request(app).get(`${base}/me/activity${q}`).set('Authorization', `Bearer ${token}`)

    expect((await call('?days=500')).body.data.series).toHaveLength(90)
    expect((await call('?days=1')).body.data.series).toHaveLength(7)
    // 0 clamps to the minimum 7 (not the default 30), and a fractional value must not
    // reach new Array(days) → RangeError → 500.
    expect((await call('?days=0')).body.data.series).toHaveLength(7)
    const frac = await call('?days=15.7')
    expect(frac.status).toBe(200)
    expect(frac.body.data.series).toHaveLength(15)
    expect((await call('?days=abc')).body.data.series).toHaveLength(30)
  })

  it('requires auth (401)', async () => {
    const res = await request(app).get(`${base}/me/activity`)
    expect(res.status).toBe(401)
  })
})
