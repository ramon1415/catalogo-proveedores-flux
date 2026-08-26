import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import { CompanyProvider } from './lib/company'
import App from './App'
import './theme/tokens.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename="/app">
      <AuthProvider>
        <CompanyProvider>
          <App />
        </CompanyProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
