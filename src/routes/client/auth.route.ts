import { Router } from 'express'
import * as authController from '../../controllers/auth.controller.js'
import * as passwordResetController from '../../controllers/password-reset.controller.js'
import { validate } from '../../middlewares/validate.middleware.js'
import { loginSchema, signupSchema } from '../../schemas/auth.schema.js'
import {
  requestPasswordResetSchema,
  resetPasswordSchema,
} from '../../schemas/password-reset.schema.js'

const router = Router()

router.post('/login', validate(loginSchema), authController.login)
router.post('/signup', validate(signupSchema), authController.signup)

router.post(
  '/request-password-reset',
  validate(requestPasswordResetSchema),
  passwordResetController.requestPasswordReset,
)
router.post('/reset-password', validate(resetPasswordSchema), passwordResetController.resetPassword)

export default router
