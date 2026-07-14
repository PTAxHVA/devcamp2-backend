import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import request from 'supertest'
import mongoose from 'mongoose'
import app from '../src/app.js'
import { connectTestDb, disconnectTestDb } from './helpers/test-db.js'
import { MasterRoadmap } from '../src/models/master-roadmap.model.js'
import { MasterBranch } from '../src/models/master-branch.model.js'
import { MasterTopic } from '../src/models/master-topic.model.js'
import { AiFeedbackTip } from '../src/models/ai-feedback-tip.model.js'
import { parseAndValidate, applyPlan, seedFeedbackTips } from '../scripts/seed-content.js'

// Intercept every AI provider call so a test can simulate success (source 'ai') or
// an outage (source 'fallback') deterministically, and never leave the process.
const { generateContentMock } = vi.hoisted(() => ({ generateContentMock: vi.fn() }))
vi.mock('../src/config/ai-model.js', () => ({
  aiModel: { generateContent: generateContentMock },
}))

const aiJson = (payload: unknown) => ({ response: { text: () => JSON.stringify(payload) } })
const aiDown = () => {
  throw new Error('AI provider down (simulated)')
}

const base = '/api/v1/client'

describe('POST /ai/roadmap-feedback — source tagging + DB fallback', () => {
  let token: string
  let userRoadmapId: string
  let coreTopicId: string // Git & GitHub: a core FE topic, no exclusive group
  let vueTopicId: string // Vue: exclusive UI-Framework branch → conflicts with enrolled React
  let backendTopicId: string // a Backend-only topic → not in the FE roadmap

  beforeAll(async () => {
    await connectTestDb()
    const plan = await parseAndValidate()
    await applyPlan(plan)

    const signup = await request(app)
      .post(`${base}/auth/signup`)
      .send({ email: 'fbsrc@example.com', password: 'Sup3rPass!', username: 'fbsrcuser' })
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

    coreTopicId = (await MasterTopic.findOne({ slug: 'git-github' }).lean())!._id.toString()
    vueTopicId = (await MasterTopic.findOne({ slug: 'vue' }).lean())!._id.toString()
    backendTopicId = (await MasterTopic.findOne({ slug: 'node-js-express' }).lean())!._id.toString()
  }, 180000)
  afterAll(disconnectTestDb)

  // Each test owns the tip collection + the mock: no tips and no stubbed AI provider
  // unless the test sets them up itself.
  afterEach(async () => {
    await AiFeedbackTip.deleteMany({})
    generateContentMock.mockReset()
  })

  const feedback = (body: { action: 'add' | 'remove'; topicId: string }) =>
    request(app)
      .post(`${base}/ai/roadmap-feedback`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userRoadmapId, ...body })

  // 1 — AI provider OK.
  it('tags source "ai" and returns AI feedback when the AI provider succeeds', async () => {
    generateContentMock.mockResolvedValue(
      aiJson({ feedback: 'Great fit for your goal.', severity: 'info' }),
    )
    const res = await feedback({ action: 'add', topicId: coreTopicId })
    expect(res.status).toBe(200)
    expect(res.body.data.source).toBe('ai')
    expect(res.body.data.feedback).toBe('Great fit for your goal.')
    expect(res.body.data.severity).toBe('info')
    expect(generateContentMock).toHaveBeenCalledTimes(1)
  })

  // 1b — a well-formed but blank AI reply is rejected by the schema → fallback
  // (so an empty note is never shown as real AI advice).
  it('degrades to fallback when the AI provider returns a blank feedback string', async () => {
    generateContentMock.mockResolvedValue(aiJson({ feedback: '   ', severity: 'info' }))
    const res = await feedback({ action: 'add', topicId: coreTopicId })
    expect(res.status).toBe(200)
    expect(res.body.data.source).toBe('fallback')
    expect(res.body.data.feedback.length).toBeGreaterThan(0)
  })

  // 2 — AI provider fails, DB has a tip.
  it('tags source "fallback" and uses the DB tip when the AI provider fails and a tip exists', async () => {
    await seedFeedbackTips()
    generateContentMock.mockImplementation(aiDown)
    const res = await feedback({ action: 'remove', topicId: coreTopicId })
    expect(res.status).toBe(200)
    expect(res.body.data.source).toBe('fallback')
    const dbTip = await AiFeedbackTip.findOne({ action: 'remove', scenario: 'default' }).lean()
    expect(res.body.data.feedback).toBe(dbTip!.text)
    expect(res.body.data.severity).toBe(dbTip!.severity)
  })

  // 3 — CRITICAL invariant: the AI provider fails AND the tip DB is empty → still 200.
  it('still returns a fallback (200, never 5xx) when the AI provider fails and the tip DB is empty', async () => {
    // No seedFeedbackTips() → AiFeedbackTip is empty → in-code inlineFallback.
    generateContentMock.mockImplementation(aiDown)
    const res = await feedback({ action: 'add', topicId: coreTopicId })
    expect(res.status).toBe(200)
    expect(res.body.data.source).toBe('fallback')
    expect(res.body.data.feedback.length).toBeGreaterThan(0)
    expect(res.body.data.severity).toBe('warning')
  })

  // 3b — never 5xx even if the tip DB query ITSELF throws (belt-and-suspenders
  // branch of the never-500 invariant): AI provider down AND AiFeedbackTip.findOne errors.
  it('still returns a fallback (200) when the tip DB query throws', async () => {
    generateContentMock.mockImplementation(aiDown)
    const spy = vi.spyOn(AiFeedbackTip, 'findOne').mockImplementationOnce(() => {
      throw new Error('DB read failed (simulated)')
    })
    try {
      const res = await feedback({ action: 'add', topicId: coreTopicId })
      expect(res.status).toBe(200)
      expect(res.body.data.source).toBe('fallback')
      expect(res.body.data.feedback.length).toBeGreaterThan(0)
    } finally {
      spy.mockRestore()
    }
  })

  // 4 — branch-conflict add, AI provider fails → warning that names both branches.
  it('uses the branch-conflict tip (names both branches) when adding a conflicting branch', async () => {
    await seedFeedbackTips()
    generateContentMock.mockImplementation(aiDown)
    // Vue while already enrolled on React → exclusive "UI Framework" conflict.
    const res = await feedback({ action: 'add', topicId: vueTopicId })
    expect(res.status).toBe(200)
    expect(res.body.data.source).toBe('fallback')
    expect(res.body.data.severity).toBe('warning')
    expect(res.body.data.feedback).toContain('Vue')
    expect(res.body.data.feedback).toContain('React')
  })

  // 5 — contract.
  it('always returns the { feedback, severity, source } contract with a valid source', async () => {
    generateContentMock.mockResolvedValue(aiJson({ feedback: 'Looks good.', severity: 'info' }))
    const res = await feedback({ action: 'add', topicId: coreTopicId })
    expect(res.body.success).toBe(true)
    expect(res.body.data).toHaveProperty('feedback')
    expect(res.body.data).toHaveProperty('severity')
    expect(['ai', 'fallback']).toContain(res.body.data.source)
  })

  // 6 — preserved guards (must fire before the AI provider is ever called).
  it('rejects an unauthenticated request (401)', async () => {
    const res = await request(app)
      .post(`${base}/ai/roadmap-feedback`)
      .send({ userRoadmapId, action: 'add', topicId: coreTopicId })
    expect(res.status).toBe(401)
    expect(generateContentMock).not.toHaveBeenCalled()
  })

  it('404s when the roadmap does not belong to the user', async () => {
    const res = await request(app)
      .post(`${base}/ai/roadmap-feedback`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        userRoadmapId: new mongoose.Types.ObjectId().toString(),
        action: 'add',
        topicId: coreTopicId,
      })
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('USER_ROADMAP_NOT_FOUND')
    expect(generateContentMock).not.toHaveBeenCalled()
  })

  it('400s when the topic is not part of the roadmap', async () => {
    const res = await feedback({ action: 'add', topicId: backendTopicId })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('TOPIC_NOT_IN_ROADMAP')
    expect(generateContentMock).not.toHaveBeenCalled()
  })

  // 7 — seed idempotency.
  it('seeds feedback tips idempotently (a second run does not duplicate)', async () => {
    const first = await seedFeedbackTips()
    const countAfterFirst = await AiFeedbackTip.countDocuments()
    const second = await seedFeedbackTips()
    const countAfterSecond = await AiFeedbackTip.countDocuments()
    expect(first).toBe(second)
    expect(countAfterFirst).toBe(countAfterSecond)
    expect(countAfterSecond).toBe(first)
  })
})
