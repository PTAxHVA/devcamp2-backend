import { Router } from 'express'
import * as sectionController from '../../controllers/section.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'
import * as quizController from '../../controllers/quiz.controller.js'

const router = Router()

router.get('/:sectionId', authenticate, sectionController.getSectionById)
router.get('/:sectionId/quiz', authenticate, quizController.getQuizBySectionId)

export default router
