import { redirect } from 'next/navigation'

/** The password section moved to the profile page; old links and bookmarks land there. */
export default function PasswordPage() {
  redirect('/settings/profile#mot-de-passe')
}
