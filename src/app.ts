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
// Liveness + readiness đặt TRƯỚC rate limiter và phải bỏ qua nó: Render
// health-checker ping /health rất thường xuyên (mỗi vài giây khi instance awake),
// nếu bị đếm chung bucket sẽ vượt limit → 429 → Render đánh instance FAILED rồi
// restart lặp (flap), làm request người dùng bị reset. Probe không được rate-limit.
app.get('/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok' } })
})

// Readiness: 200 chỉ khi DB đã kết nối. KHÔNG gate trên AI provider — AI degrade
// gracefully (mất AI vẫn học được), nên AI provider không thuộc điều kiện readiness.
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

// Rate limiter đặt TRƯỚC body parser (nhưng SAU /health + /ready ở trên) để một request
// vượt limit bị chặn trước khi buffer bất kỳ body nào — kể cả avatar 512 KB trên /me/profile.
app.use(generalRateLimiter)

// A profile avatar data-URL (capped ~280 KB by the Zod schema) needs a larger body than the
// ~100 KB default. Scope the 512 KB parser to that route, registered BEFORE the global default
// parser (it sets `req._body`, so the global parser skips this path); every other route keeps
// the small default limit.
app.use('/api/v1/client/me/profile', express.json({ limit: '512kb' }))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

mountRoutes(app)

app.use(notFoundMiddleware)
app.use(errorMiddleware)

export default app
