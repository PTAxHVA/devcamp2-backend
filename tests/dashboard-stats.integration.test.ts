import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { connectTestDb, disconnectTestDb, clearCollections } from './helpers/test-db.js'
import { seedRoadmap } from './helpers/fixtures.js'

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

describe('dashboard / catalog / roadmap-detail contract (H5, M9, M5)', () => {
  beforeAll(connectTestDb)
  afterAll(disconnectTestDb)
  afterEach(clearCollections)

  it('GET /master-roadmaps returns topicsCount per roadmap (M9)', async () => {
    await seedRoadmap('Frontend M9', ['A', 'B', 'C'])
    const res = await request(app).get(`${base}/master-roadmaps`)
    expect(res.status).toBe(200)
    const item = (res.body.data as Array<{ roleName: string; topicsCount: number }>).find(
      (r) => r.roleName === 'Frontend M9',
    )
    expect(item?.topicsCount).toBe(3)
  })

  it('GET /dashboard returns numeric completedTopics and null quizAvg for a fresh learner (H5)', async () => {
    const token = await register('h5@example.com')
    const r = await seedRoadmap('Frontend H5')
    await enroll(token, r.roadmapId, r.branchId)
    const res = await request(app).get(`${base}/dashboard`).set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.stats.completedTopics).toBe(0)
    expect(res.body.data.stats.quizAvg).toBeNull()
  })

  it('GET /roadmaps/:id threads topic descriptionShort into the graph (M5)', async () => {
    const token = await register('m5@example.com')
    const r = await seedRoadmap('Frontend M5')
    const e = await enroll(token, r.roadmapId, r.branchId)
    const userRoadmapId = e.body.data._id as string
    const res = await request(app)
      .get(`${base}/roadmaps/${userRoadmapId}`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(typeof res.body.data.topics[0].descriptionShort).toBe('string')
  })
})
