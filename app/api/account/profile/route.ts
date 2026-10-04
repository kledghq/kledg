import { NextResponse } from 'next/server'
import { authedRoute } from '@/lib/api/route'
import { updateProfile } from '@/lib/account/profile.service'
import { UpdateProfileSchema } from '@/lib/account/schemas'

/** Updates the signed-in user's name. */
export const PATCH = authedRoute({ body: UpdateProfileSchema }, async ({ user, body }) => {
  return NextResponse.json(await updateProfile(user.id, body))
})
