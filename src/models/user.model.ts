import { Schema, model } from 'mongoose'

export interface IUser {
  username: string
  email: string
  passwordHash: string
  createdAt?: Date
  updatedAt?: Date
}

const userSchema = new Schema<IUser>(
  {
    username: { type: String, required: true, trim: true, minlength: 2, maxlength: 50 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true, select: false },
  },
  { timestamps: true },
)

export const User = model<IUser>('User', userSchema)
