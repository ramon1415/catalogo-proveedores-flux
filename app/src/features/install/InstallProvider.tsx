import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { InstallGuide } from './InstallGuide'
import { useAuth } from '../../lib/auth'
import { enableInstallMetadata } from './installMetadata'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}
type InstallState = { eligible: boolean; installed: boolean; busy: boolean; install: () => void }
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
  const {session,profile,loading,signOut}=useAuth()
  const token=session?.access_token||''
  const [verified,setVerified]=useState('')
  const [checked,setChecked]=useState(false)
  const queue=useRef<Promise<void>>(Promise.resolve())
  const eligible=!!token&&verified===token&&profile?.active===true&&!loading
  const eligibility=useRef(false);eligibility.current=eligible
  const promptRef = useRef<InstallPromptEvent | null>(null)
  const busyRef = useRef(false)
  const [installed, setInstalled] = useState(isStandalone)
  const [busy, setBusy] = useState(false)
  const [guide, setGuide] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(()=>{
    let cancelled=false;let removeMetadata=()=>{}
    setVerified('');setChecked(false);setGuide(false);promptRef.current=null
    if(window.location.hostname!=='flux.quantta.mx'){setChecked(true);return}
    const canCheck=!!token&&!!profile?.id&&profile.active===true&&!loading
    // Serialize cookie updates so an old login cannot overwrite a later logout/account switch.
    queue.current=queue.current.catch(()=>{}).then(async()=>{
      try{
        const response=await fetch('/api/pwa',{method:canCheck?'POST':'DELETE',credentials:'same-origin',cache:'no-store',
          headers:canCheck?{Authorization:`Bearer ${token}`}:{}})
        if(cancelled)return
        const data=await response.json()
        if(canCheck&&response.ok&&data.eligible===true&&data.profileId===profile?.id){
          removeMetadata=enableInstallMetadata(document)
          setVerified(token)
        }
      }catch{/* Leave the normal browser available, without installation metadata. */}
      finally{if(!cancelled)setChecked(true)}
    })
    return()=>{cancelled=true;removeMetadata();promptRef.current=null}
  },[token,profile?.id,profile?.active,loading])

  useEffect(() => {
    const display = window.matchMedia('(display-mode: standalone)')
    const capture = (event: Event) => {
      event.preventDefault()
      if(eligibility.current)promptRef.current = event as InstallPromptEvent
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
    if (!eligible || installed) return
    setFailed(false)
    // Some browsers keep the native prompt pending. A second click can always
    // open instructions without reusing the prompt or blocking the user.
    if (busyRef.current) { setGuide(true); return }
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
      if(eligibility.current){setFailed(true);setGuide(true)}
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  if(installed&&session&&!loading&&!eligible)return <div className="center"><div><h2>{checked?'Instalación no disponible para esta cuenta':'Verificando acceso…'}</h2>{checked&&<><p>Abre Flux en tu navegador para continuar con tu cuenta.</p><a href="https://flux.quantta.mx" target="_blank" rel="noopener noreferrer">Abrir en el navegador</a><p><button type="button" onClick={()=>void signOut()}>Cambiar de cuenta</button></p></>}</div></div>
  return (
    <Context.Provider value={{ eligible, installed, busy, install }}>
      {children}
      {eligible && guide && <InstallGuide failed={failed} onClose={() => setGuide(false)} />}
    </Context.Provider>
  )
}
