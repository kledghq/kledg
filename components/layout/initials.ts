/** Up to two initials of a name or an email ("Marie Dupont" gives "MD"), for avatars. */
export function initials(name: string): string {
  return name
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("")
}

/** The name shown for a user: their name, else the local part of their email. */
export function displayName(user: { name?: string | null; email?: string | null }): string {
  return user.name?.trim() || user.email?.split("@")[0] || "Utilisateur"
}
