import type { Express } from 'express'
import { mountClientRoutes } from './client/index.js'
import { mountAdminRoutes } from './admin/index.js'

export const mountRoutes = (app: Express) => {
  mountClientRoutes(app)
  mountAdminRoutes(app)
}
