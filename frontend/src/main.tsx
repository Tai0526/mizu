import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// Apply the saved theme before React paints, so a dark-mode user never gets a
// flash of the light palette on load.
const saved = localStorage.getItem('mizu.theme')
const dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
document.documentElement.classList.toggle('dark', dark)

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
