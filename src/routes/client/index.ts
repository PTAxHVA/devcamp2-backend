import type { Express } from 'express'
import authRoute from './auth.route.js'
import topicRoute from './topic.route.js'
import sectionRoute from './section.route.js'
import quizRoute from './quiz.route.js'
import attemptRoute from './attempt.route.js'
import aiRoute from './ai.route.js'
import dashboardRoute from './dashboard.route.js'
import userRoute from './user.route.js'

export const mountClientRoutes = (app: Express) => {
  const base = '/api/v1/client'
  app.use(`${base}/auth`, authRoute)
  app.use(`${base}/topics`, topicRoute)
  app.use(`${base}/sections`, sectionRoute)
  app.use(`${base}/quizzes`, quizRoute)
  app.use(`${base}/attempts`, attemptRoute)
  app.use(`${base}/ai`, aiRoute)
  app.use(`${base}/dashboard`, dashboardRoute)
  app.use(`${base}/me`, userRoute)
}
