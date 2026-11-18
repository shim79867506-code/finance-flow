import type { Metadata } from 'next'
import './globals.css'
export const metadata: Metadata = {title:'FinanceFlow | 재무회계 통합관리',description:'ERP 전표 검증 및 재무 분석'}
export default function Layout({children}:Readonly<{children:React.ReactNode}>) {
  return <html lang="ko"><body>{children}</body></html>
}
