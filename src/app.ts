import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { env } from './config/env.js'
import { mountRoutes } from './routes/index.js'
import { errorMiddleware } from './middlewares/error.middleware.js'
import { notFoundMiddleware } from './middlewares/not-found.middleware.js'
import { generalRateLimiter } from './middlewares/rate-limit.middleware.js'
import { geminiModel } from './config/gemini.js'
import { connectDB } from './config/database.js'

const app = express()

app.use(helmet())
app.use(cors({ credentials: true, origin: env.CLIENT_URL }))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(generalRateLimiter)

app.get('/health', async (_req, res) => {
  try {
    await Promise.all([
      connectDB(),
      geminiModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: 'Hello, how are you?' }] }],
      }),
    ])
    res.json({ success: true, data: { status: 'ok' } })
  } catch (error) {
    res
      .status(500)
      .json({ success: false, data: { status: 'error', message: (error as Error).message } })
  }
})

mountRoutes(app)

app.use(notFoundMiddleware)
app.use(errorMiddleware)

export default app
