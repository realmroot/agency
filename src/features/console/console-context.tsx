import { createContext, useContext } from 'react'
import type { AuthContext, Project } from '@/lib/enborrpc'

export interface ConsoleContextValue {
  auth: AuthContext
  projects: Project[]
  selectProject: (projectId: string) => void
}

const ConsoleContext = createContext<ConsoleContextValue | null>(null)

export function ConsoleContextProvider({ value, children }: { value: ConsoleContextValue; children: React.ReactNode }) {
  return <ConsoleContext.Provider value={value}>{children}</ConsoleContext.Provider>
}

export function useConsoleContext() {
  const context = useContext(ConsoleContext)
  if (!context) {
    throw new Error('useConsoleContext must be used inside ConsoleContextProvider')
  }
  return context
}
