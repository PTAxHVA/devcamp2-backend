import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { connectTestDb, disconnectTestDb } from './helpers/test-db.js'
import { MasterTopic } from '../src/models/master-topic.model.js'
import { MasterRoadmap } from '../src/models/master-roadmap.model.js'
import { MasterBranch } from '../src/models/master-branch.model.js'
import { Section } from '../src/models/section.model.js'
import { Quiz } from '../src/models/quiz.model.js'
import { parseAndValidate, applyPlan } from '../scripts/seed-content.js'
import { TOPIC_DESCRIPTIONS, resolveTopicDescription } from '../scripts/topic-descriptions.js'

const base = '/api/v1/client'
// Matches an empty / placeholder string (TODO, TBD, N/A, "-", "none", blank).
const PLACEHOLDER = /^\s*(todo|tbd|n\/?a|placeholder|none|-)?\s*$/i

// The real plan is parsed once (cheap); applyPlan(plan) is the heavy part, so it
// runs in beforeAll and the mechanism tests re-apply on top of that seeded state.
type SeedPlan = Awaited<ReturnType<typeof parseAndValidate>>

describe('topic descriptions — content map (no DB)', () => {
  // #1 — the description source is captured into what the seeder writes.
  it('resolves the authored, trimmed description for a known slug', () => {
    const html = TOPIC_DESCRIPTIONS['html']
    expect(html).toBeDefined()
    expect(resolveTopicDescription('html').description).toBe(html!.description.trim())
    expect(resolveTopicDescription('html').description.length).toBeGreaterThan(0)
  })

  it('returns empty strings for an unknown slug (seeder warns, never throws)', () => {
    expect(resolveTopicDescription('not-a-real-topic')).toEqual({
      description: '',
      descriptionShort: '',
    })
  })

  // #5 — content quality: every curated description is a real sentence.
  it('every curated description is a real sentence, not a placeholder', () => {
    for (const [slug, d] of Object.entries(TOPIC_DESCRIPTIONS)) {
      expect(d.description.length, slug).toBeGreaterThanOrEqual(20)
      expect(d.description, slug).not.toMatch(PLACEHOLDER)
      expect(d.descriptionShort.length, slug).toBeGreaterThan(0)
      // Authored already-trimmed so resolve() is a pure pass-through.
      expect(d.description, slug).toBe(d.description.trim())
    }
  })
})

describe('topic descriptions — seeding (in-memory Mongo)', () => {
  let plan: SeedPlan

  beforeAll(async () => {
    await connectTestDb()
    plan = await parseAndValidate() // reads the real seed-data CSVs once
    await applyPlan(plan) // one full seed; mechanism tests re-apply on top
  }, 120000)
  afterAll(disconnectTestDb)

  // #2 + #5 + #7 — fresh seed populates description on EVERY topic, distinct from
  // the topic name, and the rest of the content graph still builds.
  it('populates a quality description on every MasterTopic + still builds sections/quizzes', async () => {
    const topics = await MasterTopic.find().lean()
    expect(topics.length).toBeGreaterThanOrEqual(14)
    for (const t of topics) {
      expect(t.description, t.slug).not.toBe('')
      expect(t.description.length, t.slug).toBeGreaterThanOrEqual(20)
      expect(t.descriptionShort, t.slug).not.toBe('')
      expect(t.description.toLowerCase(), t.slug).not.toBe(t.name.toLowerCase())
    }
    expect(await MasterRoadmap.countDocuments()).toBe(2)
    expect(await Section.countDocuments()).toBeGreaterThan(0)
    expect(await Quiz.countDocuments()).toBeGreaterThan(0)
  })

  // #5 — every distinct topic that exists in the CSVs has a curated description.
  it('covers every distinct CSV topic with a curated description (!== its name)', () => {
    for (const [slug, t] of plan.topics) {
      const d = resolveTopicDescription(slug)
      expect(d.description.length, slug).toBeGreaterThanOrEqual(20)
      expect(d.description.toLowerCase(), slug).not.toBe(t.name.toLowerCase())
      expect(d.descriptionShort.length, slug).toBeGreaterThan(0)
    }
  })

  // #6 — the API a learner hits returns the populated description.
  it('GET /topics/:id returns the populated description for an enrolled user', async () => {
    const signup = await request(app)
      .post(`${base}/auth/signup`)
      .send({ email: 'desc@example.com', password: 'Sup3rPass!', username: 'descuser' })
    const token = signup.body.data.token as string

    const roadmap = await MasterRoadmap.findOne({ roleName: 'Frontend Web Developer' }).lean()
    const branch = await MasterBranch.findOne({ name: 'React + Tailwind' }).lean()
    expect(roadmap, 'seeded FE roadmap').not.toBeNull()
    expect(branch, 'seeded FE branch').not.toBeNull()

    const enroll = await request(app)
      .post(`${base}/roadmaps`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        masterRoadmapId: roadmap!._id.toString(),
        branchSelections: [branch!._id.toString()],
      })
    expect([200, 201]).toContain(enroll.status)

    const html = await MasterTopic.findOne({ slug: 'html' }).lean()
    expect(html, 'seeded html topic').not.toBeNull()

    const res = await request(app)
      .get(`${base}/topics/${html!._id.toString()}`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.description).toBe(resolveTopicDescription('html').description)
    expect(res.body.data.description).not.toBe('')
  })

  // #3 — THE CORE FIX. A topic seeded blank (old prod data) gets backfilled on
  // re-seed. This only passes because description moved to $set; it fails if the
  // field is still on $setOnInsert. Self-heals (applyPlan restores it).
  it('backfills description on a topic that was seeded blank ($set, not $setOnInsert)', async () => {
    await MasterTopic.updateOne(
      { slug: 'html' },
      { $set: { description: '', descriptionShort: '' } },
    )
    const blanked = await MasterTopic.findOne({ slug: 'html' }).lean()
    expect(blanked!.description).toBe('') // precondition: simulated old doc

    await applyPlan(plan)

    const healed = await MasterTopic.findOne({ slug: 'html' }).lean()
    expect(healed!.description).toBe(resolveTopicDescription('html').description)
    expect(healed!.description).not.toBe('')
  }, 90000)

  // #4 — re-running the seed does not duplicate topics or drift descriptions.
  it('is idempotent: a second run keeps topic count + descriptions stable', async () => {
    const before = await MasterTopic.find().sort({ slug: 1 }).lean()
    const beforeDesc = new Map(before.map((t) => [t.slug, t.description]))

    await applyPlan(plan) // re-run, same source

    const after = await MasterTopic.find().sort({ slug: 1 }).lean()
    expect(after.length).toBe(before.length)
    for (const t of after) {
      expect(t.description, t.slug).toBe(beforeDesc.get(t.slug))
    }
  }, 90000)
})
