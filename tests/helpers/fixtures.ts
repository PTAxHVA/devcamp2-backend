import type { Types } from 'mongoose'
import { MasterRoadmap } from '../../src/models/master-roadmap.model.js'
import { MasterBranch } from '../../src/models/master-branch.model.js'
import { MasterTopic } from '../../src/models/master-topic.model.js'
import { BranchTopic } from '../../src/models/branch-topic.model.js'

export interface SeededRoadmap {
  roadmapId: string
  branchId: string
  topicIds: string[]
}

// Unique-slug counter so repeated seeds in one suite don't collide on the
// MasterTopic.slug unique index.
let slugCounter = 0

/**
 * Seed a minimal published master roadmap: 1 branch + N topics linked via
 * BranchTopic (ordered). Enough for enroll / cap / IDOR / customize tests.
 */
export const seedRoadmap = async (
  roleName: string,
  topicNames: string[] = ['Topic A', 'Topic B'],
): Promise<SeededRoadmap> => {
  const roadmap = await MasterRoadmap.create({
    roleName,
    description: `${roleName} roadmap`,
    isPublished: true,
  })
  const branch = await MasterBranch.create({
    roadmapId: roadmap._id,
    name: `${roleName} Core`,
    orderIndex: 0,
  })

  const topicIds: string[] = []
  for (let i = 0; i < topicNames.length; i += 1) {
    slugCounter += 1
    const topic = await MasterTopic.create({
      name: topicNames[i],
      slug: `topic-${slugCounter}`,
      estimatedHours: 2,
      isPublished: true,
    })
    await BranchTopic.create({ branchId: branch._id, topicId: topic._id, orderIndex: i })
    topicIds.push(topic._id.toString())
  }

  return {
    roadmapId: roadmap._id.toString(),
    branchId: branch._id.toString(),
    topicIds,
  }
}

export interface SeededForkRoadmap {
  roadmapId: string
  coreBranchId: string
  mongoBranchId: string
  pgBranchId: string
  basicsTopicId: string
  serverTopicId: string
  tailTopicId: string
  mongoTopicId: string
  pgTopicId: string
}

/**
 * Seed a published roadmap with a mutually-exclusive fork group, mirroring the
 * real seeder's Database fork: a mandatory core branch (basics -> server ->
 * tail) + two exclusive 'Database' branches, each holding one alternative topic
 * at the SAME orderIndex slot between server and tail. Prereqs mirror the
 * composition-walk derivation: both alternatives require server, and tail
 * requires BOTH alternatives (per-roadmap in-set filtering reduces that to the
 * enrolled one).
 */
export const seedForkRoadmap = async (roleName: string): Promise<SeededForkRoadmap> => {
  const roadmap = await MasterRoadmap.create({
    roleName,
    description: `${roleName} roadmap`,
    isPublished: true,
  })
  const core = await MasterBranch.create({
    roadmapId: roadmap._id,
    name: `${roleName} Core`,
    orderIndex: 0,
    isMandatory: true,
  })
  const mongoBranch = await MasterBranch.create({
    roadmapId: roadmap._id,
    name: 'MongoDB',
    orderIndex: 1,
    selectionGroup: 'Database',
    isMutuallyExclusive: true,
  })
  const pgBranch = await MasterBranch.create({
    roadmapId: roadmap._id,
    name: 'PostgreSQL',
    orderIndex: 2,
    selectionGroup: 'Database',
    isMutuallyExclusive: true,
  })

  const makeTopic = async (name: string, requiredTopicIds: Types.ObjectId[] = []) => {
    slugCounter += 1
    return MasterTopic.create({
      name,
      slug: `topic-${slugCounter}`,
      estimatedHours: 2,
      isPublished: true,
      dependsOn: { requiredTopicIds, requiredBranchIds: [] },
    })
  }
  const basics = await makeTopic('Basics')
  const server = await makeTopic('Server Fundamentals', [basics._id])
  const mongoTopic = await makeTopic('Mongo Alternative', [server._id])
  const pgTopic = await makeTopic('Postgres Alternative', [server._id])
  const tail = await makeTopic('Auth Tail', [mongoTopic._id, pgTopic._id])

  await BranchTopic.create({ branchId: core._id, topicId: basics._id, orderIndex: 0 })
  await BranchTopic.create({ branchId: core._id, topicId: server._id, orderIndex: 1 })
  await BranchTopic.create({ branchId: mongoBranch._id, topicId: mongoTopic._id, orderIndex: 2 })
  await BranchTopic.create({ branchId: pgBranch._id, topicId: pgTopic._id, orderIndex: 2 })
  await BranchTopic.create({ branchId: core._id, topicId: tail._id, orderIndex: 3 })

  return {
    roadmapId: roadmap._id.toString(),
    coreBranchId: core._id.toString(),
    mongoBranchId: mongoBranch._id.toString(),
    pgBranchId: pgBranch._id.toString(),
    basicsTopicId: basics._id.toString(),
    serverTopicId: server._id.toString(),
    tailTopicId: tail._id.toString(),
    mongoTopicId: mongoTopic._id.toString(),
    pgTopicId: pgTopic._id.toString(),
  }
}
