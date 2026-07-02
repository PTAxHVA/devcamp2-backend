import { describe, it, expect } from 'vitest'
import { buildRoadmapGraph, type GraphTopicInput } from '../src/services/roadmap-graph'

/**
 * Guards the edge mechanism that the seeder's prerequisite pass (T21) feeds:
 * once MasterTopic.dependsOn.requiredTopicIds is populated, the roadmap-viz must
 * render connecting edges (closes T07). These are pure, DB-free assertions.
 */
const topic = (over: Partial<GraphTopicInput> & { masterTopicId: string }): GraphTopicInput => ({
  userTopicId: null,
  name: over.masterTopicId.toUpperCase(),
  descriptionShort: '',
  orderIndex: 0,
  estimatedHours: 1,
  prerequisiteTopicIds: [],
  rawStatus: null,
  sectionTotal: 1,
  sectionCompleted: 0,
  ...over,
})

describe('buildRoadmapGraph', () => {
  it('emits a prereq -> dependent edge when a topic has an in-roadmap prerequisite', () => {
    const graph = buildRoadmapGraph([
      topic({ masterTopicId: 'a', orderIndex: 0, sectionCompleted: 1 }),
      topic({ masterTopicId: 'b', orderIndex: 1, prerequisiteTopicIds: ['a'] }),
    ])

    expect(graph.edges).toEqual([{ source: 'a', target: 'b' }])
  })

  it('marks a topic available once its prerequisite is completed, locked otherwise', () => {
    const completedPrereq = buildRoadmapGraph([
      topic({ masterTopicId: 'a', sectionCompleted: 1 }),
      topic({ masterTopicId: 'b', orderIndex: 1, prerequisiteTopicIds: ['a'] }),
    ])
    expect(completedPrereq.topics.find((t) => t.masterTopicId === 'b')?.status).toBe('available')

    const incompletePrereq = buildRoadmapGraph([
      topic({ masterTopicId: 'a', sectionCompleted: 0 }),
      topic({ masterTopicId: 'b', orderIndex: 1, prerequisiteTopicIds: ['a'] }),
    ])
    expect(incompletePrereq.topics.find((t) => t.masterTopicId === 'b')?.status).toBe('locked')
  })

  it('ignores prerequisites that are outside this roadmap (Scenario B shared topics)', () => {
    const graph = buildRoadmapGraph([
      topic({ masterTopicId: 'b', prerequisiteTopicIds: ['x-not-in-roadmap'] }),
    ])

    expect(graph.edges).toEqual([])
    expect(graph.topics[0]?.status).toBe('available')
  })
})
