import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { connectTestDb, disconnectTestDb } from './helpers/test-db.js'
import { MasterTopic } from '../src/models/master-topic.model.js'
import { MasterRoadmap } from '../src/models/master-roadmap.model.js'
import { MasterBranch } from '../src/models/master-branch.model.js'
import { parseAndValidate, applyPlan } from '../scripts/seed-content.js'
import { TOPIC_DESCRIPTIONS, resolveTopicDescription } from '../scripts/topic-descriptions.js'

const base = '/api/v1/client'
// Matches an empty / placeholder string (TODO, TBD, N/A, "-", "none", blank).
const PLACEHOLDER = /^\s*(todo|tbd|n\/?a|placeholder|none|-)?\s*$/i

type SeedPlan = Awaited<ReturnType<typeof parseAndValidate>>

describe('why-learn — content map (no DB)', () => {
  it('resolves the authored, trimmed whyLearn for a known slug', () => {
    const html = TOPIC_DESCRIPTIONS['html']
    expect(html).toBeDefined()
    expect(resolveTopicDescription('html').whyLearn).toBe(html!.whyLearn.trim())
    expect(resolveTopicDescription('html').whyLearn.length).toBeGreaterThan(0)
  })

  it('returns empty whyLearn for an unknown slug (seeder warns, never throws)', () => {
    expect(resolveTopicDescription('not-a-real-topic').whyLearn).toBe('')
  })

  it('every curated whyLearn is a real sentence, distinct from the description', () => {
    for (const [slug, d] of Object.entries(TOPIC_DESCRIPTIONS)) {
      expect(d.whyLearn.length, slug).toBeGreaterThanOrEqual(20)
      expect(d.whyLearn, slug).not.toMatch(PLACEHOLDER)
      expect(d.whyLearn, slug).not.toBe(d.description)
      // Authored already-trimmed so resolve() is a pure pass-through.
      expect(d.whyLearn, slug).toBe(d.whyLearn.trim())
    }
  })
})

describe('why-learn — seeding (in-memory Mongo)', () => {
  let plan: SeedPlan

  beforeAll(async () => {
    await connectTestDb()
    plan = await parseAndValidate()
    await applyPlan(plan)
  }, 120000)
  afterAll(disconnectTestDb)

  // Fresh seed populates whyLearn on EVERY topic, distinct from the topic name.
  it('populates a quality whyLearn on every MasterTopic', async () => {
    const topics = await MasterTopic.find().lean()
    expect(topics.length).toBe(plan.topics.size)
    for (const t of topics) {
      expect(t.whyLearn, t.slug).not.toBe('')
      expect(t.whyLearn.length, t.slug).toBeGreaterThanOrEqual(20)
      expect(t.whyLearn.toLowerCase(), t.slug).not.toBe(t.name.toLowerCase())
    }
  })

  // Every distinct CSV topic has a curated whyLearn.
  it('covers every distinct CSV topic with a curated whyLearn', () => {
    for (const [slug] of plan.topics) {
      const d = resolveTopicDescription(slug)
      expect(d.whyLearn.length, slug).toBeGreaterThanOrEqual(20)
    }
  })

  // The API a learner hits returns the populated whyLearn.
  it('GET /topics/:id returns the populated whyLearn for an enrolled user', async () => {
    const signup = await request(app)
      .post(`${base}/auth/signup`)
      .send({ email: 'whylearn@example.com', password: 'Sup3rPass!', username: 'whyuser' })
    const token = signup.body.data.token as string

    const roadmap = await MasterRoadmap.findOne({ roleName: 'Frontend Web Developer' }).lean()
    expect(roadmap, 'seeded FE roadmap').not.toBeNull()
    const branches = await MasterBranch.find({ roadmapId: roadmap!._id }).lean()
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
    expect(html, 'seeded html topic').not.toBeNull()

    const res = await request(app)
      .get(`${base}/topics/${html!._id.toString()}`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.whyLearn).toBe(resolveTopicDescription('html').whyLearn)
    expect(res.body.data.whyLearn).not.toBe('')
  })

  // THE CORE FIX. A topic seeded blank (old prod data) gets backfilled on
  // re-seed — only passes because whyLearn is written via $set, not $setOnInsert.
  it('backfills whyLearn on a topic that was seeded blank ($set, not $setOnInsert)', async () => {
    await MasterTopic.updateOne({ slug: 'html' }, { $set: { whyLearn: '' } })
    const blanked = await MasterTopic.findOne({ slug: 'html' }).lean()
    expect(blanked!.whyLearn).toBe('') // precondition: simulated old doc

    await applyPlan(plan)

    const healed = await MasterTopic.findOne({ slug: 'html' }).lean()
    expect(healed!.whyLearn).toBe(resolveTopicDescription('html').whyLearn)
    expect(healed!.whyLearn).not.toBe('')
  }, 90000)

  // Re-running the seed does not duplicate topics or drift whyLearn.
  it('is idempotent: a second run keeps topic count + whyLearn stable', async () => {
    const before = await MasterTopic.find().sort({ slug: 1 }).lean()
    const beforeWhy = new Map(before.map((t) => [t.slug, t.whyLearn]))

    await applyPlan(plan)

    const after = await MasterTopic.find().sort({ slug: 1 }).lean()
    expect(after.length).toBe(before.length)
    for (const t of after) {
      expect(t.whyLearn, t.slug).toBe(beforeWhy.get(t.slug))
    }
  }, 90000)
})
