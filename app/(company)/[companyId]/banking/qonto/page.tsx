'use client'

import { useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'

export default function QontoPage() {
  const router = useRouter()
  const params = useParams()
  const companyId = params?.companyId as string | undefined

  useEffect(() => {
    // Bank connections (Qonto included) are set up on the "Connecter une banque" page
    if (companyId) {
      router.replace(`/${companyId}/banking/connect`)
    } else {
      router.replace('/companies')
    }
  }, [router, companyId])

  return null
}
