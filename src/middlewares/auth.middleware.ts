import type { Request, Response, NextFunction } from 'express'
import { ApiError } from '../utils/api-error.js'
import { verifyToken, type Role } from '../utils/jwt.js'

export const authenticate = (req: Request, _res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) throw new ApiError(401, 'Unauthorized', 'NO_TOKEN')

  try {
    const payload = verifyToken(token)
    req.user = { id: payload.sub, role: payload.role }
    next()
  } catch {
    throw new ApiError(401, 'Invalid or expired token', 'INVALID_TOKEN')
  }
}

export const authorize =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new ApiError(403, 'Forbidden', 'INSUFFICIENT_ROLE')
    }
    next()
  }
