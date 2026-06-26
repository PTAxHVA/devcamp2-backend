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

const patch = (token: string, id: string, body: Record<string, unknown>) =>
  request(app).patch(`${base}/roadmaps/${id}`).set('Authorization', `Bearer ${token}`).send(body)

describe('user roadmap (integration)', () => {
  beforeAll(connectTestDb)
  afterAll(disconnectTestDb)
  afterEach(clearCollections)

  it('enrolls, enforces the 2-roadmap cap, and blocks duplicate enrollment', async () => {
    const token = await register('cap@example.com')
    const r1 = await seedRoadmap('Frontend Cap')
    const r2 = await seedRoadmap('Backend Cap')
    const r3 = await seedRoadmap('Mobile Cap')

    const e1 = await enroll(token, r1.roadmapId, r1.branchId)
    expect([200, 201]).toContain(e1.status)
    expect(e1.body.data.topicCount).toBe(2)

    // Re-enrolling the same roadmap while still under the cap is a duplicate.
    const dup = await enroll(token, r1.roadmapId, r1.branchId)
    expect(dup.status).toBe(409)
    expect(dup.body.error.code).toBe('ROADMAP_ALREADY_ACTIVE')

    const e2 = await enroll(token, r2.roadmapId, r2.branchId)
    expect([200, 201]).toContain(e2.status)

    // A third distinct roadmap exceeds the 2-active cap.
    const e3 = await enroll(token, r3.roadmapId, r3.branchId)
    expect(e3.status).toBe(409)
    expect(e3.body.error.code).toBe('ROADMAP_CAP_REACHED')

    // Precedence: once at the cap, even re-enrolling an active roadmap hits the
    // cap check first (it runs before the duplicate-active check).
    const dupAtCap = await enroll(token, r1.roadmapId, r1.branchId)
    expect(dupAtCap.status).toBe(409)
    expect(dupAtCap.body.error.code).toBe('ROADMAP_CAP_REACHED')
  })

  it('scopes roadmap detail to its owner (IDOR)', async () => {
    const ownerToken = await register('owner@example.com')
    const intruderToken = await register('intruder@example.com')
    const r = await seedRoadmap('Frontend IDOR')
    const enrolled = await enroll(ownerToken, r.roadmapId, r.branchId)
    const userRoadmapId = enrolled.body.data._id as string

    const asOwner = await request(app)
      .get(`${base}/roadmaps/${userRoadmapId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(asOwner.status).toBe(200)
    expect(asOwner.body.data.topics).toHaveLength(2)

    const asIntruder = await request(app)
      .get(`${base}/roadmaps/${userRoadmapId}`)
      .set('Authorization', `Bearer ${intruderToken}`)
    expect(asIntruder.status).toBe(404)
    expect(asIntruder.body.error.code).toBe('USER_ROADMAP_NOT_FOUND')
  })

  it('customizes a roadmap: remove a topic, add it back, and refuse to empty it', async () => {
    const token = await register('editor@example.com')
    const r = await seedRoadmap('Frontend Edit')
    const enrolled = await enroll(token, r.roadmapId, r.branchId)
    const id = enrolled.body.data._id as string
    const [t1, t2] = r.topicIds

    const removed = await patch(token, id, { removeTopicIds: [t1] })
    expect(removed.status).toBe(200)
    expect(removed.body.data.topicCount).toBe(1)

    const added = await patch(token, id, { addTopicIds: [t1] })
    expect(added.status).toBe(200)
    expect(added.body.data.topicCount).toBe(2)

    const emptied = await patch(token, id, { removeTopicIds: [t1, t2] })
    expect(emptied.status).toBe(400)
    expect(emptied.body.error.code).toBe('ROADMAP_EMPTY')
  })

  it('refuses to add a topic that does not belong to the roadmap branches', async () => {
    const token = await register('badd@example.com')
    const r = await seedRoadmap('Frontend AddBad')
    const other = await seedRoadmap('Other Roadmap')
    const enrolled = await enroll(token, r.roadmapId, r.branchId)
    const id = enrolled.body.data._id as string

    const res = await patch(token, id, { addTopicIds: [other.topicIds[0]] })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('TOPIC_NOT_IN_BRANCH')
  })
})
