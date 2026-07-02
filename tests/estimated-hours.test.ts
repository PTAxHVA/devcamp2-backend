import { describe, it, expect } from 'vitest'
import { topicEstimatedHours } from '../scripts/seed-content'

/**
 * Pure, DB-free guard for the topic-duration fix. estimatedHours is derived from a
 * topic's '_default' resource list ONCE — it must not be multiplied by the number
 * of sections (the bug that produced "18 hours" on the topic page).
 */
const res = (estimatedMinutes: number) => ({
  title: 'r',
  url: 'https://example.com',
  type: 'docs' as const,
  provider: 'MDN',
  estimatedMinutes,
})

describe('topicEstimatedHours', () => {
  it('sums the _default resource minutes and converts to hours', () => {
    const map = { html: { _default: [res(120), res(180), res(300)] } } // 600 min
    expect(topicEstimatedHours(map, 'html')).toBe(10)
  })

  it('rounds to one decimal (dev-env: 60 + 30 + 120 = 210 min → 3.5h)', () => {
    const map = { 'dev-environment-setup': { _default: [res(60), res(30), res(120)] } }
    expect(topicEstimatedHours(map, 'dev-environment-setup')).toBe(3.5)
  })

  it('counts _default ONCE and ignores per-section override lists', () => {
    // A section-specific list must not inflate the topic total — only _default counts.
    const map = { css: { _default: [res(420)], flexbox: [res(999)] } } // 420 min = 7h
    expect(topicEstimatedHours(map, 'css')).toBe(7)
  })

  it('returns 0 for a topic with no curated resources', () => {
    expect(topicEstimatedHours({}, 'unknown')).toBe(0)
    expect(topicEstimatedHours({ x: { _default: [] } }, 'x')).toBe(0)
  })
})
