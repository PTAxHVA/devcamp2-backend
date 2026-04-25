import type { Express } from 'express'
import authRoute from './auth.route.js'
import sampleRoute from './sample.route.js'

export const mountClientRoutes = (app: Express) => {
  const base = '/api/v1/client'
  app.use(`${base}/auth`, authRoute)
  app.use(`${base}/samples`, sampleRoute) // demo route — proves DB connection
  // M3: mount additional feature routes here
  // app.use(`${base}/users`, userRoute)
  // app.use(`${base}/roadmaps`, roadmapRoute)
  // app.use(`${base}/topics`, topicRoute)
  // app.use(`${base}/quizzes`, quizRoute)
  // app.use(`${base}/progress`, progressRoute)
  // app.use(`${base}/ai`, aiRoute)
}
