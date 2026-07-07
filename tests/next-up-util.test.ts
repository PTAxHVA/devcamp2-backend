import { describe, it, expect } from 'vitest'
import { buildNextUpMap } from '../src/utils/next-up.util.js'

const ut = (id: string, roadmap: string, topic: string, orderIndex: number) => ({
  _id: id,
  userRoadmapId: roadmap,
  topicId: topic,
  orderIndex,
})

const sec = (id: string, topic: string, orderIndex: number, isPublished = true) => ({
  _id: id,
  topicId: topic,
  name: `Section ${id}`,
  slug: `section-${id}`,
  orderIndex,
  isPublished,
})

const done = (userTopic: string, section: string) => ({
  userTopicId: userTopic,
  sectionId: section,
  isCompleted: true,
})

describe('buildNextUpMap (BN2b continue-learning fallback)', () => {
  it('fresh roadmap → first published section of the first topic', () => {
    const map = buildNextUpMap(
      [ut('utB', 'r1', 'tB', 1), ut('utA', 'r1', 'tA', 0)],
      [sec('s2', 'tA', 1), sec('s1', 'tA', 0), sec('s3', 'tB', 0)],
      [],
    )
    expect(map.get('r1')).toEqual({
      topicId: 'tA',
      sectionId: 's1',
      name: 'Section s1',
      slug: 'section-s1',
    })
  })

  it('partially-done later topic beats an untouched earlier one', () => {
    const map = buildNextUpMap(
      [ut('utA', 'r1', 'tA', 0), ut('utB', 'r1', 'tB', 1)],
      [sec('s1', 'tA', 0), sec('s2', 'tB', 0), sec('s3', 'tB', 1)],
      [done('utB', 's2')],
    )
    expect(map.get('r1')?.sectionId).toBe('s3')
    expect(map.get('r1')?.topicId).toBe('tB')
  })

  it('completed sections are skipped inside a topic', () => {
    const map = buildNextUpMap(
      [ut('utA', 'r1', 'tA', 0)],
      [sec('s1', 'tA', 0), sec('s2', 'tA', 1)],
      [done('utA', 's1')],
    )
    expect(map.get('r1')?.sectionId).toBe('s2')
  })

  it('unpublished sections never surface; topics with none published are skipped', () => {
    const map = buildNextUpMap(
      [ut('utA', 'r1', 'tA', 0), ut('utB', 'r1', 'tB', 1)],
      [sec('s1', 'tA', 0, false), sec('s2', 'tB', 0)],
      [],
    )
    expect(map.get('r1')?.sectionId).toBe('s2')
  })

  it('fully completed roadmap gets no entry', () => {
    const map = buildNextUpMap(
      [ut('utA', 'r1', 'tA', 0)],
      [sec('s1', 'tA', 0)],
      [done('utA', 's1')],
    )
    expect(map.has('r1')).toBe(false)
  })

  it('failed (isCompleted:false) rows do not count as done', () => {
    const map = buildNextUpMap(
      [ut('utA', 'r1', 'tA', 0)],
      [sec('s1', 'tA', 0), sec('s2', 'tA', 1)],
      [{ userTopicId: 'utA', sectionId: 's1', isCompleted: false }],
    )
    expect(map.get('r1')?.sectionId).toBe('s1')
  })
})
