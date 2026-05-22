import * as crypto from 'crypto'

export const rawResetToken = () => crypto.randomBytes(64).toString('hex')

export const hashedResetToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex')
