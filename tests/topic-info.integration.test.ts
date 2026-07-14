import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { Types } from 'mongoose'
import request from 'supertest'
import app from '../src/app.js'
import { connectTestDb, disconnectTestDb, clearCollections } from './helpers/test-db.js'
import { MasterTopic } from '../src/models/master-topic.model.js'
import { Section } from '../src/models/section.model.js'

const base = '/api/v1/client'

const register = async (email: string): Promise<string> => {
  const res = await request(app)
    .post(`${base}/auth/signup`)
    .send({ email, password: 'Sup3rPass!', username: email.split('@')[0] })
  return res.body.data.token as string
}

// A library topic with two published sections and one unpublished one, so the
// endpoint's published-only + orderIndex sort can be verified.
const seedTopic = async () => {
  const topic = await MasterTopic.create({
    name: 'TypeScript',
    slug: 'typescript',
    description: 'Typed JavaScript at scale.',
    whyLearn: 'Catch bugs before they ship and make big codebases maintainable.',
    estimatedHours: 6,
  })
  await Section.create({
    topicId: topic._id,
    name: 'Types & Interfaces',
    slug: 'types',
    isPublished: true,
    orderIndex: 1,
  })
  await Section.create({
    topicId: topic._id,
    name: 'Getting started',
    slug: 'getting-started',
    isPublished: true,
    orderIndex: 0,
  })
  await Section.create({
    topicId: topic._id,
    name: 'Draft — not published',
    slug: 'draft',
    isPublished: false,
    orderIndex: 2,
  })
  return topic._id.toString()
}

describe('GET /topics/:topicId/info (pre-enrollment topic preview)', () => {
  beforeAll(connectTestDb)
  afterAll(disconnectTestDb)
  afterEach(clearCollections)

  it('returns why-learn + published sections WITHOUT any enrollment', async () => {
    const token = await register('preview@test.dev')
    const topicId = await seedTopic()

    const res = await request(app)
      .get(`${base}/topics/${topicId}/info`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.name).toBe('TypeScript')
    expect(res.body.data.whyLearn).toContain('Catch bugs')
    expect(res.body.data.estimatedHours).toBe(6)
    // Published only, ordered by orderIndex; the unpublished draft is excluded.
    expect(res.body.data.sectionList.map((s: { name: string }) => s.name)).toEqual([
      'Getting started',
      'Types & Interfaces',
    ])
    // No enrollment-scoped fields leak in.
    expect(res.body.data.userProgress).toBeUndefined()
  })

  it('is reachable pre-enrollment where the enrolled endpoint 404s', async () => {
    const token = await register('unenrolled@test.dev')
    const topicId = await seedTopic()

    const info = await request(app)
      .get(`${base}/topics/${topicId}/info`)
      .set('Authorization', `Bearer ${token}`)
    const enrolled = await request(app)
      .get(`${base}/topics/${topicId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(info.status).toBe(200)
    expect(enrolled.status).toBe(404) // USER_ROADMAP_NOT_FOUND — proves the split
  })

  it('400s an invalid topic id', async () => {
    const token = await register('badid@test.dev')
    const res = await request(app)
      .get(`${base}/topics/not-an-object-id/info`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_TOPIC_ID')
  })

  it('404s an unknown topic id', async () => {
    const token = await register('missing@test.dev')
    const res = await request(app)
      .get(`${base}/topics/${new Types.ObjectId().toString()}/info`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('TOPIC_NOT_FOUND')
  })

  it('401s without a token', async () => {
    const topicId = await seedTopic()
    const res = await request(app).get(`${base}/topics/${topicId}/info`)
    expect(res.status).toBe(401)
  })
})
