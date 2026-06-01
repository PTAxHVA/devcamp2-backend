import { Router } from 'express'
import { authenticate } from '../../middlewares/auth.middleware.js'
import * as dashboardController from '../../controllers/dashboard.controller.js'

const route = Router()

route.get('/', authenticate, dashboardController.getDashboardAnalytics)

export default route
