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
