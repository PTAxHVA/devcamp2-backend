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

describe('GET /me/progress active filter', () => {
  beforeAll(connectTestDb)
  afterAll(disconnectTestDb)
  afterEach(clearCollections)

  it('drops a soft-deleted (unregistered) roadmap from progress', async () => {
    const token = await register('prog1@example.com')
    const rA = await seedRoadmap('FE Prog')
    const rB = await seedRoadmap('BE Prog')
    const eA = await enroll(token, rA.roadmapId, rA.branchId)
    await enroll(token, rB.roadmapId, rB.branchId)

    const before = await request(app)
      .get(`${base}/me/progress`)
      .set('Authorization', `Bearer ${token}`)
    expect(before.body.data).toHaveLength(2)

    const del = await request(app)
      .delete(`${base}/roadmaps/${eA.body.data._id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(del.status).toBe(200)

    const after = await request(app)
      .get(`${base}/me/progress`)
      .set('Authorization', `Bearer ${token}`)
    expect(after.body.data).toHaveLength(1)
    expect(after.body.data[0].roadmapId).toBe(rB.roadmapId)
  })
})
