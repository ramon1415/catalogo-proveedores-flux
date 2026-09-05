import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { InstallGuide } from './InstallGuide'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}
type InstallState = { installed: boolean; busy: boolean; install: () => void }
const Context = createContext<InstallState | null>(null)
export function useInstall() {
  const state = useContext(Context)
  if (!state) throw new Error('useInstall requiere InstallProvider')
  return state
}
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

export function InstallProvider({ children }: { children: ReactNode }) {
  const promptRef = useRef<InstallPromptEvent | null>(null)
  const busyRef = useRef(false)
  const [installed, setInstalled] = useState(isStandalone)
  const [busy, setBusy] = useState(false)
  const [guide, setGuide] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const display = window.matchMedia('(display-mode: standalone)')
    const capture = (event: Event) => {
      event.preventDefault()
      promptRef.current = event as InstallPromptEvent
    }
    const complete = () => {
      promptRef.current = null
      setInstalled(true)
      setGuide(false)
    }
    const syncDisplay = () => { if (isStandalone()) complete() }
    window.addEventListener('beforeinstallprompt', capture)
    window.addEventListener('appinstalled', complete)
    display.addEventListener('change', syncDisplay)
    return () => {
      window.removeEventListener('beforeinstallprompt', capture)
      window.removeEventListener('appinstalled', complete)
      display.removeEventListener('change', syncDisplay)
    }
  }, [])

  async function install() {
    if (installed || busyRef.current) return
    setFailed(false)
    const event = promptRef.current
    if (!event) { setGuide(true); return }
    // Single-use prompt, retained across Login -> App. No automatic retries.
    promptRef.current = null
    busyRef.current = true
    setBusy(true)
    try {
      await event.prompt()
      await event.userChoice
      // appinstalled/display-mode confirms installation, not the user's click.
    } catch {
      setFailed(true)
      setGuide(true)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  return (
    <Context.Provider value={{ installed, busy, install }}>
      {children}
      {guide && <InstallGuide failed={failed} onClose={() => setGuide(false)} />}
    </Context.Provider>
  )
}
