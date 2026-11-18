import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) return null
  const jar = await cookies()
  return createServerClient(url, key, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: pending => {
        try { pending.forEach(({ name, value, options }) => jar.set(name, value, options)) }
        catch { /* Server components cannot write cookies. The proxy handles refresh. */ }
      },
    },
  })
}
