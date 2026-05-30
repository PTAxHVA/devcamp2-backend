import * as aiController from '../../controllers/ai.controller.js'
import { Router } from 'express'
import { aiRateLimiter } from '../../middlewares/rate-limit.middleware.js'
import { authenticate } from '../../middlewares/auth.middleware.js'

const route = Router()

route.post('/roadmap-suggest', authenticate, aiRateLimiter, aiController.suggestRoadmap)

export default route
