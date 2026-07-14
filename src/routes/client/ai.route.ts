import * as aiController from '../../controllers/ai.controller.js'
import { Router } from 'express'
import { aiRateLimiter, globalAiRateLimiter } from '../../middlewares/rate-limit.middleware.js'
import { authenticate } from '../../middlewares/auth.middleware.js'
import { validate } from '../../middlewares/validate.middleware.js'
import {
  explainMistakesSchema,
  jobReadinessSchema,
  roadmapFeedbackSchema,
  roadmapSuggestSchema,
} from '../../schemas/ai.schema.js'

const route = Router()

route.post(
  '/roadmap-suggest',
  authenticate,
  aiRateLimiter,
  globalAiRateLimiter,
  validate(roadmapSuggestSchema),
  aiController.suggestRoadmap,
)

route.post(
  '/roadmap-feedback',
  authenticate,
  aiRateLimiter,
  globalAiRateLimiter,
  validate(roadmapFeedbackSchema),
  aiController.feedbackRoadmap,
)

// Static role list for the FE picker — no AI provider call, so no AI limiters.
route.get('/job-readiness/roles', authenticate, aiController.listJobReadinessRoles)

route.post(
  '/job-readiness',
  authenticate,
  aiRateLimiter,
  globalAiRateLimiter,
  validate(jobReadinessSchema),
  aiController.analyzeJobReadiness,
)

// On-demand post-quiz mistake review — one AI provider call per learner click.
route.post(
  '/explain-mistakes',
  authenticate,
  aiRateLimiter,
  globalAiRateLimiter,
  validate(explainMistakesSchema),
  aiController.explainMistakes,
)

export default route
