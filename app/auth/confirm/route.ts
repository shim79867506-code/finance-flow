import { NextRequest, NextResponse } from 'next/server'
import { serverClient } from '../../../lib/supabase'

export async function GET(request: NextRequest) {
  const token_hash = request.nextUrl.searchParams.get('token_hash')
  const code = request.nextUrl.searchParams.get('code')
  const db = await serverClient()
  if (db && (token_hash || code)) {
    const {error} = token_hash
      ? await db.auth.verifyOtp({token_hash,type:'email'})
      : await db.auth.exchangeCodeForSession(code!)
    if (!error) return NextResponse.redirect(new URL('/',request.url))
  }
  return NextResponse.redirect(new URL('/?authError=1',request.url))
}
