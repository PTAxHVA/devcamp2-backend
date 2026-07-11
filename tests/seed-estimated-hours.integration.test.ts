import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { connectTestDb, disconnectTestDb } from './helpers/test-db.js'
import { MasterTopic } from '../src/models/master-topic.model.js'
import { MasterRoadmap } from '../src/models/master-roadmap.model.js'
import { MasterBranch } from '../src/models/master-branch.model.js'
import { parseAndValidate, applyPlan } from '../scripts/seed-content.js'

const base = '/api/v1/client'
type SeedPlan = Awaited<ReturnType<typeof parseAndValidate>>

/**
 * estimatedHours is derived from curated resources at seed time and moved to $set
 * (was a hardcoded 0 on $setOnInsert). These tests prove: it lands populated in the
 * DB, the topic API surfaces it, and a re-seed backfills topics that were seeded 0.
 */
describe('seed estimatedHours — derived from curated resources (in-memory Mongo)', () => {
  let plan: SeedPlan

  beforeAll(async () => {
    await connectTestDb()
    plan = await parseAndValidate() // reads the real seed-data CSVs + resources.json
    await applyPlan(plan)
  }, 120000)
  afterAll(disconnectTestDb)

  it('populates a positive estimatedHours on every seeded topic', async () => {
    const topics = await MasterTopic.find().lean()
    expect(topics.length).toBeGreaterThanOrEqual(14)
    for (const t of topics) {
      expect(t.estimatedHours, t.slug).toBeGreaterThan(0)
    }
  })

  it('computes hours as the topic _default resource minutes / 60', async () => {
    const html = await MasterTopic.findOne({ slug: 'html' }).lean()
    expect(html?.estimatedHours).toBe(10) // 120 + 180 + 300 = 600 min
    const devEnv = await MasterTopic.findOne({ slug: 'dev-environment-setup' }).lean()
    expect(devEnv?.estimatedHours).toBe(3.5) // 60 + 30 + 120 = 210 min
  })

  it('GET /topics/:id returns estimatedHours for an enrolled user', async () => {
    const signup = await request(app)
      .post(`${base}/auth/signup`)
      .send({ email: 'hours@example.com', password: 'Sup3rPass!', username: 'hoursuser' })
    const token = signup.body.data.token as string

    const roadmap = await MasterRoadmap.findOne({ roleName: 'Frontend Web Developer' }).lean()
    expect(roadmap, 'seeded FE roadmap').not.toBeNull()
    const branches = await MasterBranch.find({ roadmapId: roadmap!._id }).lean()
    // Valid fork selection: mandatory core + one framework + one styling.
    const pick = (name: string) => branches.find((b) => b.name === name)
    const branchSelections = [pick('Frontend Core'), pick('React'), pick('Tailwind CSS')]
    expect(branchSelections.every(Boolean), 'seeded FE fork branches').toBe(true)

    const enroll = await request(app)
      .post(`${base}/roadmaps`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        masterRoadmapId: roadmap!._id.toString(),
        branchSelections: branchSelections.map((b) => b!._id.toString()),
      })
    expect([200, 201]).toContain(enroll.status)

    const html = await MasterTopic.findOne({ slug: 'html' }).lean()
    const res = await request(app)
      .get(`${base}/topics/${html!._id.toString()}`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.estimatedHours).toBe(10)
  })

  it('backfills estimatedHours on a topic seeded 0 ($set, not $setOnInsert)', async () => {
    await MasterTopic.updateOne({ slug: 'html' }, { $set: { estimatedHours: 0 } })
    const zeroed = await MasterTopic.findOne({ slug: 'html' }).lean()
    expect(zeroed?.estimatedHours).toBe(0) // precondition: simulated old doc

    await applyPlan(plan)

    const healed = await MasterTopic.findOne({ slug: 'html' }).lean()
    expect(healed?.estimatedHours).toBe(10)
  }, 90000)
})
