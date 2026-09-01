import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import { CompanyProvider } from './lib/company'
import { ModulesProvider } from './lib/moduleAccess'
import { ToastProvider } from './components/ui/Toast'
import App from './App'
import './theme/tokens.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <CompanyProvider>
          <ModulesProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </ModulesProvider>
        </CompanyProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
