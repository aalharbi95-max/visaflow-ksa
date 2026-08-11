import React from 'react'
import ReactDOM from 'react-dom/client'
import { getViteSupabaseConfig } from './supabaseConfig.mjs'
import './style.css'

const root = ReactDOM.createRoot(document.getElementById('root'))

async function startApplication() {
  try {
    const isHousingApplication = window.location.pathname.startsWith('/housing')
      || new URLSearchParams(window.location.search).get('app') === 'housing'

    if (isHousingApplication) {
      const { default: HousingApp } = await import('./HousingApp.jsx')
      document.documentElement.lang = 'ar'
      document.documentElement.dir = 'rtl'
      document.title = 'سكن | إدارة السكنات'
      root.render(
        <React.StrictMode>
          <HousingApp />
        </React.StrictMode>,
      )
      return
    }

    getViteSupabaseConfig()
    const { default: App } = await import('./App.jsx')
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    )
  } catch (error) {
    console.error('VisaFlow startup configuration failed.', error)
    root.render(
      <main role="alert" style={{ margin: '4rem auto', maxWidth: '42rem', padding: '1.5rem' }}>
        <h1>Application configuration error</h1>
        <p>{error instanceof Error ? error.message : 'Required deployment configuration is unavailable.'}</p>
      </main>,
    )
  }
}

startApplication()
