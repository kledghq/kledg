'use client'

import { createContext, useContext } from 'react'
import { USER_MENU_ITEM_IDS, type UserMenuItemId } from './user-menu'

const VisibleUserMenuContext = createContext<readonly UserMenuItemId[]>(USER_MENU_ITEM_IDS)

/**
 * Hands the client menus the user menu entries the instance keeps
 * (computed on the server by filterUserMenu). Without a provider every
 * entry is visible.
 */
export function UserMenuProvider({ visible, children }: { visible: readonly UserMenuItemId[]; children: React.ReactNode }) {
  return <VisibleUserMenuContext.Provider value={visible}>{children}</VisibleUserMenuContext.Provider>
}

/** Ids of the user menu entries this instance shows. */
export function useVisibleUserMenu(): readonly UserMenuItemId[] {
  return useContext(VisibleUserMenuContext)
}
