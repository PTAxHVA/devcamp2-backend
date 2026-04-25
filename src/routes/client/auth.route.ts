import { Router } from 'express'
import * as authController from '../../controllers/auth.controller.js'
import { validate } from '../../middlewares/validate.middleware.js'
import { loginSchema, signupSchema } from '../../schemas/auth.schema.js'

const router = Router()

router.post('/login', validate(loginSchema), authController.login)
router.post('/signup', validate(signupSchema), authController.signup)

export default router
