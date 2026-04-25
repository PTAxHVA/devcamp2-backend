import type { Request, Response } from 'express'

export const notFoundMiddleware = (_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Route not found' },
  })
}
