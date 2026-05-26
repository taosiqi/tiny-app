import { HashRouter } from 'react-router-dom'
import AppShell from './layout/AppShell'
import { SettingsProvider } from './settings/SettingsContext'
import { ToastProvider } from './toast/ToastContext'

export default function App() {
  return (
    <SettingsProvider>
      <ToastProvider>
        <HashRouter>
          <AppShell />
        </HashRouter>
      </ToastProvider>
    </SettingsProvider>
  )
}
