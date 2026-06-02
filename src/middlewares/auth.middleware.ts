import type { Request, Response, NextFunction } from 'express'
import { ApiError } from '../utils/api-error.js'
import { verifyToken, type Role } from '../utils/jwt.js'
import { User } from '../models/user.model.js'

export const authenticate = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const token = req.headers.authorization?.split(' ')[1]
    if (!token) throw new ApiError(401, 'Unauthorized', 'NO_TOKEN')

    const payload = verifyToken(token)

    const user = await User.findById(payload.sub).select('isActive').lean()
    const checkIsActive = user?.isActive

    if (!checkIsActive) throw new ApiError(401, 'Unauthorized', 'INACTIVE_USER')

    req.user = { id: payload.sub, role: payload.role }
    next()
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NO_TOKEN') {
      next(error)
    } else if (error instanceof ApiError && error.code === 'INACTIVE_USER') {
      next(error)
    } else {
      next(new ApiError(401, 'Invalid or expired token', 'INVALID_TOKEN'))
    }
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
