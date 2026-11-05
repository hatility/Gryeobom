import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, remoteRepo, type Me } from './api.ts'
import { localRepo } from './store.ts'

interface Auth { user: Me | null; ready: boolean; setUser: (u: Me | null) => void }
const AuthContext = createContext<Auth>({ user: null, ready: false, setUser: () => {} })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    api.me().then((u) => {
      setUser(u)
      setReady(true)
    })
  }, [])
  return <AuthContext.Provider value={{ user, ready, setUser }}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)

/** 로그인했으면 내 계정, 아니면 이 기기에 저장한다 */
export const useRepo = () => (useAuth().user ? remoteRepo : localRepo)
