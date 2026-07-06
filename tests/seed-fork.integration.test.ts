import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { connectTestDb, disconnectTestDb } from './helpers/test-db.js'
import { MasterRoadmap } from '../src/models/master-roadmap.model.js'
import { MasterBranch } from '../src/models/master-branch.model.js'
import { MasterTopic } from '../src/models/master-topic.model.js'
import { BranchTopic } from '../src/models/branch-topic.model.js'
import { parseAndValidate, applyPlan } from '../scripts/seed-content.js'

type SeedPlan = Awaited<ReturnType<typeof parseAndValidate>>

/** Resolve a topic's slug from the parsed plan by its exact CSV Topic_Name. */
const slugOfName = (plan: SeedPlan, name: string): string => {
  for (const [slug, topic] of plan.topics) {
    if (topic.name === name) return slug
  }
  throw new Error(`Topic named "${name}" not found in the seed plan`)
}

const topicByName = async (plan: SeedPlan, name: string) => {
  const topic = await MasterTopic.findOne({ slug: slugOfName(plan, name) }).lean()
  expect(topic, `seeded topic "${name}"`).not.toBeNull()
  return topic!
}

describe('seed fork groups (in-memory Mongo, real CSVs)', () => {
  let plan: SeedPlan

  beforeAll(async () => {
    await connectTestDb()
    plan = await parseAndValidate()
    await applyPlan(plan)
  }, 180000)
  afterAll(disconnectTestDb)

  it('splits the Backend roadmap into a mandatory core + two exclusive Database branches', async () => {
    const be = await MasterRoadmap.findOne({ roleName: 'Backend Web Developer' }).lean()
    expect(be).not.toBeNull()
    const branches = await MasterBranch.find({ roadmapId: be!._id }).sort({ orderIndex: 1 }).lean()
    expect(branches.map((b) => b.name)).toEqual(['Node + Express Core', 'MongoDB', 'PostgreSQL'])

    const [core, mongo, pg] = branches
    expect(core!.selectionGroup).toBeNull()
    expect(core!.isMutuallyExclusive).toBe(false)
    expect(core!.isMandatory).toBe(true)
    expect(core!.orderIndex).toBe(0)
    for (const branch of [mongo!, pg!]) {
      expect(branch.selectionGroup).toBe('Database')
      expect(branch.isMutuallyExclusive).toBe(true)
      expect(branch.isMandatory).toBe(false)
    }

    // Edge split: core keeps 7 topics; each fork branch exactly its one topic,
    // which KEEPS its CSV Topic_ID as orderIndex so any composition (core + one
    // fork) reads in the original CSV order.
    expect(await BranchTopic.countDocuments({ branchId: core!._id })).toBe(7)
    const mongoTopic = await topicByName(plan, 'MongoDB (with Mongoose)')
    const pgTopic = await topicByName(plan, 'PostgreSQL (with Prisma)')
    const mongoEdges = await BranchTopic.find({ branchId: mongo!._id }).lean()
    const pgEdges = await BranchTopic.find({ branchId: pg!._id }).lean()
    expect(mongoEdges).toHaveLength(1)
    expect(pgEdges).toHaveLength(1)
    expect(mongoEdges[0]!.topicId.toString()).toBe(mongoTopic._id.toString())
    expect(pgEdges[0]!.topicId.toString()).toBe(pgTopic._id.toString())
    expect(pgEdges[0]!.orderIndex).toBeLessThan(mongoEdges[0]!.orderIndex) // CSV: Postgres before Mongo
  })

  it('leaves the Frontend roadmap untouched: one non-fork branch', async () => {
    const fe = await MasterRoadmap.findOne({ roleName: 'Frontend Web Developer' }).lean()
    const branches = await MasterBranch.find({ roadmapId: fe!._id }).lean()
    expect(branches).toHaveLength(1)
    expect(branches[0]!.name).toBe('React + Tailwind')
    expect(branches[0]!.selectionGroup).toBeNull()
    expect(branches[0]!.isMutuallyExclusive).toBe(false)
    expect(branches[0]!.isMandatory).toBe(false)
  })

  it('derives composition prereqs: each DB topic follows Node & Express, the join topic needs both', async () => {
    const node = await topicByName(plan, 'Node.js & Express')
    const mongo = await topicByName(plan, 'MongoDB (with Mongoose)')
    const pg = await topicByName(plan, 'PostgreSQL (with Prisma)')
    const auth = await topicByName(plan, 'Authentication & Authorization')

    const reqIds = (t: typeof node) =>
      (t.dependsOn?.requiredTopicIds ?? []).map((id) => id.toString())

    expect(reqIds(mongo)).toEqual([node._id.toString()])
    expect(reqIds(pg)).toEqual([node._id.toString()])
    expect(new Set(reqIds(auth))).toEqual(new Set([mongo._id.toString(), pg._id.toString()]))
    // Spot-check the core chain is intact.
    const ts = await topicByName(plan, 'TypeScript')
    expect(reqIds(node)).toContain(ts._id.toString())
  })

  it('reconciles a stale renamed branch (and its edges) on re-apply', async () => {
    const be = await MasterRoadmap.findOne({ roleName: 'Backend Web Developer' }).lean()
    const anyTopic = await MasterTopic.findOne().lean()
    const stale = await MasterBranch.create({
      roadmapId: be!._id,
      name: 'Node + Express + Mongo', // the pre-fork prod branch name
      orderIndex: 9,
    })
    await BranchTopic.create({ branchId: stale._id, topicId: anyTopic!._id, orderIndex: 0 })

    await applyPlan(plan)

    expect(await MasterBranch.findById(stale._id).lean()).toBeNull()
    expect(await BranchTopic.countDocuments({ branchId: stale._id })).toBe(0)
    expect(await MasterBranch.countDocuments({ roadmapId: be!._id })).toBe(3)
  }, 120000)

  it('heals blanked fork fields on existing branch docs ($set, not $setOnInsert)', async () => {
    const be = await MasterRoadmap.findOne({ roleName: 'Backend Web Developer' }).lean()
    await MasterBranch.updateOne(
      { roadmapId: be!._id, name: 'MongoDB' },
      { $set: { selectionGroup: null, isMutuallyExclusive: false } },
    )

    await applyPlan(plan)

    const healed = await MasterBranch.findOne({ roadmapId: be!._id, name: 'MongoDB' }).lean()
    expect(healed!.selectionGroup).toBe('Database')
    expect(healed!.isMutuallyExclusive).toBe(true)
  }, 120000)

  it('is idempotent: a second apply keeps branches, edges and prereqs stable', async () => {
    const branchesBefore = await MasterBranch.countDocuments()
    const edgesBefore = await BranchTopic.countDocuments()
    const authBefore = await topicByName(plan, 'Authentication & Authorization')

    await applyPlan(plan)

    expect(await MasterBranch.countDocuments()).toBe(branchesBefore)
    expect(await BranchTopic.countDocuments()).toBe(edgesBefore)
    const authAfter = await topicByName(plan, 'Authentication & Authorization')
    expect(new Set((authAfter.dependsOn?.requiredTopicIds ?? []).map(String))).toEqual(
      new Set((authBefore.dependsOn?.requiredTopicIds ?? []).map(String)),
    )
  }, 120000)
})
