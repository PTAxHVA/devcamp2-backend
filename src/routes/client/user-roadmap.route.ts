import { Router } from 'express'
import * as userRoadmapController from '../../controllers/user-roadmap.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'
import { validate } from '../../middlewares/validate.middleware.js'
import { createRoadmapSchema } from '../../schemas/roadmap.schema.js'

const router = Router()

router.post('/', authenticate, validate(createRoadmapSchema), userRoadmapController.createRoadmap)
router.get('/', authenticate, userRoadmapController.listRoadmaps)
router.get('/:id', authenticate, userRoadmapController.getRoadmapDetail)
router.delete('/:id', authenticate, userRoadmapController.deleteRoadmap)

export default router
