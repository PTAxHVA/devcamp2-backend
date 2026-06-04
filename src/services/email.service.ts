import { Resend } from 'resend'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'

const resend = new Resend(env.RESEND_API_KEY)

export const sendPasswordResetEmail = async (email: string, token: string) => {
  const url = `${env.CLIENT_URL}/auth/reset-password?token=${token}`
  const text = `Click on the link to reset your password: ${url}`
  const html = `
    <a href="${url}">${text}</a>
    `

  const { data, error } = await resend.emails.send({
    from: env.RESEND_FROM_EMAIL,
    to: email,
    subject: 'Reset Password',
    text: text,
    html,
  })

  if (error) {
    logger.error({ message: 'Resend Error', error })
    throw new Error('Failed to send email')
  }

  return data
}
