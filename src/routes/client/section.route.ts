import { Router } from 'express'
import * as sectionController from '../../controllers/section.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'

const router = Router()

router.get('/:sectionId', authenticate, sectionController.getSectionById)

export default router
