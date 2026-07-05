/**
 * Curated target roles for the Job-Readiness Gap Analyzer.
 *
 * MVP is a role PICKER (no free-text job descriptions): the FE offers exactly
 * these roles and the BE rejects anything else, which keeps the prompt-injection
 * surface near zero and guarantees every role has a curated fallback below.
 *
 * fallbackTopicSlugs = the hand-curated "required topics" used when Gemini is
 * down, times out, or answers garbage. Slugs must match the seed-data topic
 * names run through scripts/seed-content.ts slugify() (e.g. "Git & GitHub" →
 * "git-github", "Node.js & Express" → "node-js-express"). A slug that no longer
 * resolves is skipped at runtime, so a future reseed cannot break the endpoint.
 */
export interface TargetRole {
  role: string
  fallbackTopicSlugs: string[]
}

export const TARGET_ROLES: TargetRole[] = [
  {
    role: 'Junior Frontend Developer',
    fallbackTopicSlugs: [
      'html',
      'css',
      'javascript-fundamentals',
      'javascript-advanced',
      'git-github',
      'typescript',
      'react',
    ],
  },
  {
    role: 'Junior Backend Developer',
    fallbackTopicSlugs: [
      'git-github',
      'javascript-fundamentals',
      'javascript-advanced',
      'typescript',
      'node-js-express',
      'mongodb-with-mongoose',
      'authentication-authorization',
    ],
  },
  {
    role: 'Junior Fullstack Developer',
    fallbackTopicSlugs: [
      'html',
      'css',
      'git-github',
      'javascript-fundamentals',
      'javascript-advanced',
      'typescript',
      'react',
      'node-js-express',
      'mongodb-with-mongoose',
      'authentication-authorization',
    ],
  },
]

/** Case-insensitive lookup so FE label casing can never 400 a valid role. */
export const findTargetRole = (input: string): TargetRole | undefined => {
  const needle = input.trim().toLowerCase()
  return TARGET_ROLES.find((r) => r.role.toLowerCase() === needle)
}
