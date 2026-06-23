import * as aiController from '../../controllers/ai.controller.js'
import { Router } from 'express'
import { aiRateLimiter, globalAiRateLimiter } from '../../middlewares/rate-limit.middleware.js'
import { authenticate } from '../../middlewares/auth.middleware.js'
import { validate } from '../../middlewares/validate.middleware.js'
import { roadmapFeedbackSchema, roadmapSuggestSchema } from '../../schemas/ai.schema.js'

const route = Router()

route.post(
  '/roadmap-suggest',
  authenticate,
  globalAiRateLimiter,
  aiRateLimiter,
  validate(roadmapSuggestSchema),
  aiController.suggestRoadmap,
)

route.post(
  '/roadmap-feedback',
  authenticate,
  globalAiRateLimiter,
  aiRateLimiter,
  validate(roadmapFeedbackSchema),
  aiController.feedbackRoadmap,
)

export default route
