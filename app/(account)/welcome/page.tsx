import { redirect } from 'next/navigation'

/** The first-run page became Settings, Configuration: old links and bookmarks land there. */
export default function WelcomePage() {
  redirect('/settings/configuration')
}
