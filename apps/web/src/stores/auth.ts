import { create } from 'zustand'
import type { User } from '@taskify/shared'
import { get } from '@taskify/api-client'

interface AuthState {
  phone: string | null
  user: User | null
  setPhone: (phone: string) => void
  fetchUser: () => Promise<void>
  reset: () => void
}

/** 认证与当前用户状态（含额度余额，FR-E-03） */
export const useAuthStore = create<AuthState>((set) => ({
  phone: localStorage.getItem('taskify_phone'),
  user: null,
  setPhone: (phone) => {
    localStorage.setItem('taskify_phone', phone)
    set({ phone })
  },
  fetchUser: async () => {
    const user = await get<User>('/me')
    set({ user })
  },
  reset: () => {
    localStorage.removeItem('taskify_phone')
    set({ phone: null, user: null })
  },
}))
