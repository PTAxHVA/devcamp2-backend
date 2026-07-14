import { Router } from 'express'
import * as topicController from '../../controllers/topic.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'

const router = Router()

// Pre-enrollment topic preview (onboarding personalized-plan panel). Declared
// before '/:topicId' for clarity — the two-segment path can't collide with it.
router.get('/:topicId/info', authenticate, topicController.getTopicInfo)
router.get('/:topicId', authenticate, topicController.getTopicById)

export default router
