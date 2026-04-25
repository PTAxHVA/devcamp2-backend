import jwt, { type SignOptions } from 'jsonwebtoken'
import { env } from '../config/env.js'

export type Role = 'user' | 'admin'

export interface JwtPayload {
  sub: string
  role: Role
}

export const signToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as SignOptions)
}

export const verifyToken = (token: string): JwtPayload => {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload
}
