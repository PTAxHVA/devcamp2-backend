import { ApiError } from '../utils/api-error.js'
import type { LoginInput, SignupInput } from '../schemas/auth.schema.js'
import { User } from '../models/user.model.js'
import { UserProfile } from '../models/user-profile.model.js'
import { hashPassword, comparePassword } from '../utils/password.js'
import { signToken } from '../utils/jwt.js'

const normalizeEmail = (email: string) => email.toLowerCase().trim()

const buildAuthPayload = (userId: string, email: string, username: string) => {
  const token = signToken({ sub: userId, role: 'user' })
  return { token, user: { id: userId, email, username } }
}

export const login = async (input: LoginInput) => {
  const email = normalizeEmail(input.email)
  const user = await User.findOne({ email }).select('+passwordHash +isActive')

  if (!user || !(await comparePassword(input.password, user.passwordHash))) {
    throw new ApiError(401, 'Invalid email or password', 'INVALID_CREDENTIALS')
  }

  if (!user.isActive) throw new ApiError(401, 'Inactive user', 'INACTIVE_USER')

  return buildAuthPayload(String(user._id), user.email, user.username)
}

export const signup = async (input: SignupInput) => {
  const email = normalizeEmail(input.email)
  const existing = await User.findOne({ email })
  if (existing) {
    throw new ApiError(409, 'Email already registered', 'EMAIL_TAKEN')
  }

  const passwordHash = await hashPassword(input.password)

  try {
    const created = await User.create({ username: input.username, email, passwordHash })
    await UserProfile.create({ userId: created._id })
    return buildAuthPayload(String(created._id), created.email, created.username)
  } catch (err: unknown) {
    if ((err as { code?: number })?.code === 11000) {
      throw new ApiError(409, 'Email already registered', 'EMAIL_TAKEN')
    }
    throw err
  }
}
