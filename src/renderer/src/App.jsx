import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom'
import AudioTool from './components/AudioTool'
import FileCompare from './components/FileCompare'
import Settings from './components/Settings'
import TaskCenter from './components/TaskCenter'
import TinyPNG from './components/TinyPNG'
import AppShell from './layout/AppShell'
import KeepAliveLayout from './layout/KeepAliveLayout'
import { SettingsProvider } from './settings/SettingsContext'
import { ToastProvider } from './toast/ToastContext'

const router = createHashRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/tasks" replace /> },
      {
        element: <KeepAliveLayout />,
        children: [
          { path: '/tasks', element: <TaskCenter /> },
          { path: '/png', element: <TinyPNG /> },
          { path: '/audio', element: <AudioTool /> },
          { path: '/compare', element: <FileCompare /> },
          { path: '/settings', element: <Settings /> }
        ]
      }
    ]
  }
])

export default function App() {
  return (
    <SettingsProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </SettingsProvider>
  )
}
