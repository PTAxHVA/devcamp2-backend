import type { Request, Response, NextFunction } from 'express'
import { ApiError } from '../utils/api-error.js'
import { verifyToken, type Role } from '../utils/jwt.js'
import { User } from '../models/user.model.js'

export const authenticate = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const token = req.headers.authorization?.split(' ')[1]
    if (!token) throw new ApiError(401, 'Unauthorized', 'NO_TOKEN')

    let payload
    try {
      payload = verifyToken(token)
    } catch {
      throw new ApiError(401, 'Invalid or expired token', 'INVALID_TOKEN')
    }

    const user = await User.findById(payload.sub).select('isActive').lean()
    const checkIsActive = user?.isActive

    if (!checkIsActive) throw new ApiError(401, 'Unauthorized', 'INACTIVE_USER')

    req.user = { id: payload.sub, role: payload.role }
    next()
  } catch (error) {
    next(error)
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
