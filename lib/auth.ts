import { serverClient } from './supabase'

export async function session() {
  const db = await serverClient()
  if (!db) return null
  const {data} = await db.auth.getUser()
  return data.user ? {db,user:data.user} : null
}
