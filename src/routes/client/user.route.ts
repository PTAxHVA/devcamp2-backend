import { Router } from 'express'
import { authenticate } from '../../middlewares/auth.middleware.js'
import * as userController from '../../controllers/user.controller.js'

const route = Router()

route.get('/', authenticate, userController.getUserDetails)
route.get('/profile', authenticate, userController.getProfile)
route.patch('/profile', authenticate, userController.updateProfile)
route.get('/streak', authenticate, userController.getUserStreak)
route.get('/progress', authenticate, userController.getUserProgress)

export default route
