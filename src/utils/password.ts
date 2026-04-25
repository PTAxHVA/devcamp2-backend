import bcrypt from 'bcrypt'

const ROUNDS = 10

export const hashPassword = (plain: string) => bcrypt.hash(plain, ROUNDS)

export const comparePassword = (plain: string, hash: string) => bcrypt.compare(plain, hash)
