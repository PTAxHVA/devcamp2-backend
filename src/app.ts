import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { env } from './config/env.js'
import { mountRoutes } from './routes/index.js'
import { errorMiddleware } from './middlewares/error.middleware.js'
import { notFoundMiddleware } from './middlewares/not-found.middleware.js'
import { generalRateLimiter } from './middlewares/rate-limit.middleware.js'
import mongoose from 'mongoose'

// Allowed browser origins: the configured client origin + this project's Vercel
// deploys (production alias + per-PR preview URLs like
// devcamp2-frontend-<hash>.vercel.app). Any other origin is rejected by CORS.
const VERCEL_DEPLOY_PATTERN = /^https:\/\/devcamp2-frontend[a-z0-9-]*\.vercel\.app$/

const isAllowedOrigin = (origin: string): boolean =>
  origin === env.CLIENT_URL || VERCEL_DEPLOY_PATTERN.test(origin)

const app = express()

// Trust the first proxy hop (Render/any reverse proxy) so req.ip reflects the
// real client IP from X-Forwarded-For — required for correct rate limiting.
app.set('trust proxy', 1)

app.use(helmet())
app.use(
  cors({
    credentials: true,
    origin: (origin, callback) => {
      // No Origin header = non-browser request (curl, health checks) — allow.
      if (!origin || isAllowedOrigin(origin)) {
        callback(null, true)
      } else {
        callback(null, false)
      }
    },
  }),
)
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(generalRateLimiter)

// Liveness: process còn sống. Luôn 200 (Render cold-start wake gọi endpoint này).
app.get('/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok' } })
})

// Readiness: 200 chỉ khi mọi dependency đã kết nối.
app.get('/ready', (_req, res) => {
  const isMongoReady = mongoose.connection.readyState === 1
  if (isMongoReady) {
    res.json({ success: true, data: { status: 'ok', mongo: 'ok' } })
  } else {
    res.status(503).json({
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Database is not connected' },
    })
  }
})

mountRoutes(app)

app.use(notFoundMiddleware)
app.use(errorMiddleware)

export default app
