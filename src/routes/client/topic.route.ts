import { Router } from 'express'
import * as topicController from '../../controllers/topic.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'

const router = Router()

router.get('/:topicId', authenticate, topicController.getTopicById)

export default router
