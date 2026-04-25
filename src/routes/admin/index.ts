import type { Express } from 'express'

export const mountAdminRoutes = (app: Express) => {
  const base = '/api/v1/admin'
  // M3: admin routes require authenticate + authorize('admin')
  // app.use(`${base}/users`, authenticate, authorize('admin'), adminUserRoute)
  // app.use(`${base}/roadmaps`, authenticate, authorize('admin'), adminRoadmapRoute)
  void app
  void base
}
