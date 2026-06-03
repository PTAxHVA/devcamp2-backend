import { Router } from 'express'
import { authenticate } from '../../middlewares/auth.middleware.js'
import * as userController from '../../controllers/user.controller.js'
import { validate } from '../../middlewares/validate.middleware.js'
import {
  deactivateAccountSchema,
  updateAccountCredentialsSchema,
  updateProfileSchema,
} from '../../schemas/profile.schema.js'

const route = Router()

route.get('/', authenticate, userController.getUserDetails)
route.get('/profile', authenticate, userController.getProfile)
route.patch('/profile', authenticate, validate(updateProfileSchema), userController.updateProfile)
route.patch(
  '/account',
  authenticate,
  validate(updateAccountCredentialsSchema),
  userController.updateAccountCredentials,
)
route.patch(
  '/account/deactivate',
  authenticate,
  validate(deactivateAccountSchema),
  userController.deactivateAccount,
)
route.get('/streak', authenticate, userController.getUserStreak)
route.get('/progress', authenticate, userController.getUserProgress)

export default route
