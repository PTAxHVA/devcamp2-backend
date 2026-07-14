import { FeedbackSeverity } from '../types/enums.js'
import type { RoadmapFeedbackInput } from './ai-prompts.js'

/** What the learner just did in the customize editor. */
export type FeedbackAction = 'add' | 'remove'

/** Which fallback applies: a normal edit vs. adding a second exclusive branch. */
export type FeedbackScenario = 'default' | 'branch-conflict'

/** A curated fallback tip, seeded into the AiFeedbackTip collection by `yarn seed`. */
export interface FeedbackTipSeed {
  action: FeedbackAction
  scenario: FeedbackScenario
  text: string
  severity: FeedbackSeverity
}

type BranchConflict = RoadmapFeedbackInput['branchConflict']

/**
 * Branch-conflict advice; the {addedBranchName}/{currentBranchName} placeholders
 * are filled at runtime by fillBranchNames. Shared by the seeded tip and the
 * in-code inlineFallback so the two wordings can never drift apart.
 */
const BRANCH_CONFLICT_TIP =
  'Learning {addedBranchName} and {currentBranchName} at the same time can spread your focus thin — most learners finish one before starting the other.'

/**
 * Curated advice shown on the roadmap-edit AI feedback endpoint (F19) when the AI
 * provider is unavailable (down, rate-limited, or returns garbage). `yarn seed` upserts
 * these into the AiFeedbackTip collection; the service reads that collection first
 * and only uses inlineFallback() below when it is empty (e.g. a prod DB not yet
 * re-seeded) — so the endpoint degrades gracefully but never 500s.
 */
export const FEEDBACK_TIPS: FeedbackTipSeed[] = [
  {
    action: 'add',
    scenario: 'default',
    text: 'Before adding a topic, make sure its prerequisites are already in your roadmap so the new material builds on what you know.',
    severity: FeedbackSeverity.WARNING,
  },
  {
    action: 'remove',
    scenario: 'default',
    text: "Removing this topic may leave gaps in your roadmap's coverage. Review the topics that build on it before you take it out.",
    severity: FeedbackSeverity.WARNING,
  },
  {
    action: 'add',
    scenario: 'branch-conflict',
    text: BRANCH_CONFLICT_TIP,
    severity: FeedbackSeverity.WARNING,
  },
]

/**
 * Fill the {addedBranchName}/{currentBranchName} placeholders in a curated
 * branch-conflict tip. A no-op when there is no conflict or the text has no
 * placeholders, so a curator can also write a plain (nameless) sentence.
 */
export const fillBranchNames = (text: string, conflict: BranchConflict): string => {
  if (!conflict) return text
  return text
    .replaceAll('{addedBranchName}', conflict.addedBranchName)
    .replaceAll('{currentBranchName}', conflict.currentBranchName)
}

/**
 * Last-resort advice kept in code so the endpoint still returns a helpful note
 * when BOTH the AI provider and the AiFeedbackTip collection are unavailable (e.g. a prod
 * DB seeded before this feature existed). The branch-conflict wording is shared
 * with the seeded tip (BRANCH_CONFLICT_TIP); the add/remove defaults are
 * intentionally terser than the curated FEEDBACK_TIPS as a bare fallback.
 */
export const inlineFallback = (
  action: FeedbackAction,
  conflict: BranchConflict,
): { feedback: string; severity: FeedbackSeverity } => {
  if (conflict) {
    return {
      feedback: fillBranchNames(BRANCH_CONFLICT_TIP, conflict),
      severity: FeedbackSeverity.WARNING,
    }
  }
  if (action === 'add') {
    return {
      feedback: 'Please consider topic dependencies and pre-completion before adding.',
      severity: FeedbackSeverity.WARNING,
    }
  }
  return {
    feedback:
      "Removing this topic might impact your roadmap's coverage of certain concepts. Please review your roadmap before removing this topic.",
    severity: FeedbackSeverity.WARNING,
  }
}
