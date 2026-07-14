import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { connectTestDb, disconnectTestDb } from './helpers/test-db.js'
import { MasterRoadmap } from '../src/models/master-roadmap.model.js'
import { MasterBranch } from '../src/models/master-branch.model.js'
import { MasterTopic } from '../src/models/master-topic.model.js'
import { parseAndValidate, applyPlan } from '../scripts/seed-content.js'
import { buildRoadmapFeedbackPrompt, type RoadmapFeedbackInput } from '../src/config/ai-prompts.js'

const base = '/api/v1/client'

// F19 extension: adding a topic from a mutually-exclusive branch while a sibling
// branch is already enrolled (e.g. Vue while on React) surfaces a "two paths at once"
// risk warning — the AI prompt gets the conflict, and the fallback names both branches.

describe('roadmap-feedback prompt — branch conflict (unit, no DB)', () => {
  const baseInput: RoadmapFeedbackInput = {
    roadmapRole: 'Frontend Web Developer',
    learnerGoal: 'job',
    action: 'add',
    editedTopic: {
      name: 'Vue',
      descriptionShort: 'Progressive framework',
      prerequisiteNames: ['TypeScript'],
    },
    currentTopics: [
      { name: 'React', descriptionShort: 'UI library', prerequisiteNames: ['TypeScript'] },
    ],
  }

  it('injects the exclusive-path conflict section + both branch names when branchConflict is set', () => {
    const prompt = buildRoadmapFeedbackPrompt({
      ...baseInput,
      branchConflict: { group: 'UI Framework', currentBranchName: 'React', addedBranchName: 'Vue' },
    })
    expect(prompt).toContain('EXCLUSIVE PATH CONFLICT')
    expect(prompt).toContain('UI Framework')
    expect(prompt).toContain('"React"')
    expect(prompt).toContain('"Vue"')
  })

  it('omits the conflict section for a normal (non-conflicting) edit', () => {
    expect(buildRoadmapFeedbackPrompt(baseInput)).not.toContain('EXCLUSIVE PATH CONFLICT')
  })
})

describe('POST /ai/roadmap-feedback — branch conflict (in-memory Mongo, AI provider falls back)', () => {
  let token: string
  let userRoadmapId: string

  beforeAll(async () => {
    await connectTestDb()
    const plan = await parseAndValidate()
    await applyPlan(plan)

    const signup = await request(app)
      .post(`${base}/auth/signup`)
      .send({ email: 'fb@example.com', password: 'Sup3rPass!', username: 'fbuser' })
    token = signup.body.data.token as string
    await request(app)
      .post(`${base}/onboarding/questionnaire`)
      .set('Authorization', `Bearer ${token}`)
      .send({ rolePreference: 'frontend', goal: 'job' })

    const fe = await MasterRoadmap.findOne({ roleName: 'Frontend Web Developer' }).lean()
    const branches = await MasterBranch.find({ roadmapId: fe!._id }).lean()
    const pick = (name: string) => branches.find((b) => b.name === name)!._id.toString()
    const enroll = await request(app)
      .post(`${base}/roadmaps`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        masterRoadmapId: fe!._id.toString(),
        branchSelections: [pick('Frontend Core'), pick('React'), pick('Tailwind CSS')],
      })
    expect([200, 201]).toContain(enroll.status)
    userRoadmapId = enroll.body.data._id as string
  }, 180000)
  afterAll(disconnectTestDb)

  it('warns and names both branches when ADDING a conflicting exclusive branch (Vue while on React)', async () => {
    const vue = await MasterTopic.findOne({ slug: 'vue' }).lean()
    const res = await request(app)
      .post(`${base}/ai/roadmap-feedback`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userRoadmapId, action: 'add', topicId: vue!._id.toString() })
    expect(res.status).toBe(200)
    expect(res.body.data.severity).toBe('warning')
    // No valid AI key in tests → curated fallback, which for a conflict names both branches.
    expect(res.body.data.feedback).toContain('Vue')
    expect(res.body.data.feedback).toContain('React')
  })

  it('gives the normal (non-conflict) fallback when ADDING a core topic', async () => {
    const git = await MasterTopic.findOne({ slug: 'git-github' }).lean()
    const res = await request(app)
      .post(`${base}/ai/roadmap-feedback`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userRoadmapId, action: 'add', topicId: git!._id.toString() })
    expect(res.status).toBe(200)
    // A core topic has no exclusive group → no conflict → the generic add fallback.
    expect(res.body.data.feedback).not.toContain('spread your focus')
  })
})
