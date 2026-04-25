import type { Role } from '../utils/jwt.js'

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role: Role }
    }
  }
}

export {}
