import app from './app.js'
import { env } from './config/env.js'
import { connectDB } from './config/database.js'
import { logger } from './config/logger.js'
import { seedIfEmpty as seedSamples } from './services/sample.service.js'

const bootstrap = async () => {
  await connectDB()
  await seedSamples() // demo: insert 3 sample docs on first run
  app.listen(env.PORT, () => {
    logger.info(`Server running at http://localhost:${env.PORT}`)
  })
}

bootstrap().catch((err) => {
  logger.error({ err }, 'Bootstrap failed')
  process.exit(1)
})
