import { Resend } from 'resend'
import { ApiError } from '../utils/api-error.js'

const resend = new Resend(process.env.RESEND_API_KEY)

export const sendPasswordResetEmail = async (email: string, token: string) => {
  const html = `
    <p>Click on the link to reset your password: ${process.env.CLIENT_URL}/auth/reset-password?token=${token}</p>
    `
  const { data, error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to: email,
    subject: 'Reset Password',
    html,
  })

  if (error) {
    throw new ApiError(500, 'Failed to send email', 'FAILED_TO_SEND_EMAIL')
  }

  return data
}
