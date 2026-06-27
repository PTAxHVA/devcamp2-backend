import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { connectTestDb, disconnectTestDb, clearCollections } from './helpers/test-db.js'
import { seedRoadmap } from './helpers/fixtures.js'
import { Section } from '../src/models/section.model.js'

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

const availableTopics = (token: string, id: string) =>
  request(app)
    .get(`${base}/roadmaps/${id}/available-topics`)
    .set('Authorization', `Bearer ${token}`)

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

  describe('GET /roadmaps/:id/available-topics', () => {
    // Seed a 4-topic branch, enroll (all 4), then remove a subset in the tests so
    // the roadmap is missing exactly those topics — the read side of the picker.
    const seedAndEnrollFourTopics = async (email: string) => {
      const token = await register(email)
      const r = await seedRoadmap('FE Avail', ['Alpha', 'Beta', 'Gamma', 'Delta'])
      const enrolled = await enroll(token, r.roadmapId, r.branchId)
      return { token, r, id: enrolled.body.data._id as string }
    }

    it('returns the branch topics not yet enrolled, in branch order', async () => {
      const { token, r, id } = await seedAndEnrollFourTopics('avail-happy@example.com')
      const [, t2, , t4] = r.topicIds
      const removed = await patch(token, id, { removeTopicIds: [t2, t4] })
      expect(removed.status).toBe(200)

      const res = await availableTopics(token, id)
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      const ids = res.body.data.map((t: { masterTopicId: string }) => t.masterTopicId)
      expect(ids).toEqual([t2, t4])
      expect(res.body.data[0]).toMatchObject({
        masterTopicId: t2,
        name: 'Beta',
        estimatedHours: 2,
        sectionTotal: 0,
      })
    })

    it('excludes every topic already enrolled in the roadmap', async () => {
      const { token, r, id } = await seedAndEnrollFourTopics('avail-excludes@example.com')
      const [t1, t2, t3, t4] = r.topicIds
      await patch(token, id, { removeTopicIds: [t4] })

      const res = await availableTopics(token, id)
      expect(res.status).toBe(200)
      const ids = res.body.data.map((t: { masterTopicId: string }) => t.masterTopicId)
      expect(ids).toEqual([t4])
      expect(ids).not.toContain(t1)
      expect(ids).not.toContain(t2)
      expect(ids).not.toContain(t3)
    })

    it('returns an empty array when every branch topic is already enrolled', async () => {
      const { token, id } = await seedAndEnrollFourTopics('avail-empty@example.com')
      const res = await availableTopics(token, id)
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data).toEqual([])
    })

    it('returns 404 without leaking another user roadmap (IDOR)', async () => {
      const { id } = await seedAndEnrollFourTopics('avail-owner@example.com')
      const intruder = await register('avail-intruder@example.com')

      const res = await availableTopics(intruder, id)
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('USER_ROADMAP_NOT_FOUND')
      expect(res.body.data).toBeUndefined()
    })

    it('returns 404 for a roadmap id that does not exist', async () => {
      const token = await register('avail-missing@example.com')
      const res = await availableTopics(token, '0123456789abcdef01234567')
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('USER_ROADMAP_NOT_FOUND')
    })

    it('returns 404 for a soft-deleted roadmap', async () => {
      const { token, id } = await seedAndEnrollFourTopics('avail-deleted@example.com')
      const del = await request(app)
        .delete(`${base}/roadmaps/${id}`)
        .set('Authorization', `Bearer ${token}`)
      expect(del.status).toBe(200)

      const res = await availableTopics(token, id)
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('USER_ROADMAP_NOT_FOUND')
    })

    it('requires authentication', async () => {
      const { id } = await seedAndEnrollFourTopics('avail-auth@example.com')
      const res = await request(app).get(`${base}/roadmaps/${id}/available-topics`)
      expect(res.status).toBe(401)
      expect(res.body.success).toBe(false)
    })

    it('exposes the documented contract: envelope, exact fields, branch ordering', async () => {
      const { token, r, id } = await seedAndEnrollFourTopics('avail-contract@example.com')
      const [t1, , t3] = r.topicIds

      // Two published + one unpublished section on Alpha — only published ones count.
      await Section.create({ topicId: t1, name: 'A1', slug: `a1-${t1}`, isPublished: true })
      await Section.create({ topicId: t1, name: 'A2', slug: `a2-${t1}`, isPublished: true })
      await Section.create({ topicId: t1, name: 'A3', slug: `a3-${t1}`, isPublished: false })

      // Remove in reverse branch order to prove the response re-sorts to branch order.
      const removed = await patch(token, id, { removeTopicIds: [t3, t1] })
      expect(removed.status).toBe(200)

      const res = await availableTopics(token, id)
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(Array.isArray(res.body.data)).toBe(true)

      const ids = res.body.data.map((t: { masterTopicId: string }) => t.masterTopicId)
      expect(ids).toEqual([t1, t3])

      const alpha = res.body.data[0]
      expect(Object.keys(alpha).sort()).toEqual(
        ['estimatedHours', 'masterTopicId', 'name', 'sectionTotal'].sort(),
      )
      expect(alpha).toMatchObject({
        masterTopicId: t1,
        name: 'Alpha',
        estimatedHours: 2,
        sectionTotal: 2,
      })
    })

    it('returns ids that PATCH accepts as addTopicIds (add-compatibility)', async () => {
      const { token, r, id } = await seedAndEnrollFourTopics('avail-addcompat@example.com')
      const [, t2] = r.topicIds
      await patch(token, id, { removeTopicIds: [t2] })

      const res = await availableTopics(token, id)
      expect(res.status).toBe(200)
      const returnedId = res.body.data[0].masterTopicId as string
      expect(returnedId).toBe(t2)

      const added = await patch(token, id, { addTopicIds: [returnedId] })
      expect(added.status).toBe(200)
      expect(added.body.data.addedCount).toBe(1)
    })
  })
})
