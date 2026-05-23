import { HashRouter } from 'react-router-dom'
import AppShell from './layout/AppShell'
import { SettingsProvider } from './settings/SettingsContext'

export default function App() {
  return (
    <SettingsProvider>
      <HashRouter>
        <AppShell />
      </HashRouter>
    </SettingsProvider>
  )
}
