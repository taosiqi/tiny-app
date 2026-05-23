import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'
import './assets/app.css'

import { createRoot } from 'react-dom/client'
import App from './App'
createRoot(document.getElementById('root')).render(<App />)
