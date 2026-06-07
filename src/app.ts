import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { env } from './config/env.js'
import { mountRoutes } from './routes/index.js'
import { errorMiddleware } from './middlewares/error.middleware.js'
import { notFoundMiddleware } from './middlewares/not-found.middleware.js'
import { generalRateLimiter } from './middlewares/rate-limit.middleware.js'
import mongoose from 'mongoose'

const app = express()

app.use(helmet())
app.use(cors({ credentials: true, origin: env.CLIENT_URL }))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(generalRateLimiter)

app.get('/health', async (_req, res) => {
  res.json({ success: true, data: { status: 'ok' } })
})

app.get('/ready', (_req, res) => {
  if (mongoose.connection.readyState === 1) {
    res.json({ success: true, data: { status: 'ok' } })
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
