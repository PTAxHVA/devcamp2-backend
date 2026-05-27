import { Router } from 'express'
import { authenticate } from '../../middlewares/auth.middleware.js'
import * as QuizController from '../../controllers/quiz.controller.js'

const router = Router()

router.post('/:id/start', authenticate, QuizController.startQuizAttempt)

export default router
