import { Router } from 'express'
import { authenticate } from '../../middlewares/auth.middleware.js'
import * as quizAttemptController from '../../controllers/quiz.controller.js'

const router = Router()

router.get('/:id', authenticate, quizAttemptController.getAttempt)
router.get('/:id/result', authenticate, quizAttemptController.getAttemptResult)

export default router
