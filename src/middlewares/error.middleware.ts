import type { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'
import { ApiError } from '../utils/api-error.js'
import { logger } from '../config/logger.js'

export const errorMiddleware = (err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message },
    })
    return
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        details: err.flatten().fieldErrors,
      },
    })
    return
  }

  logger.error({ err }, 'Unhandled error')
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL', message: 'Internal Server Error' },
  })
}
