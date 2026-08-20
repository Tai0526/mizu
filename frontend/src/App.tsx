import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { Spinner } from './components/ui'
import { AuthPage } from './pages/AuthPage'
import { DiscoverPage } from './pages/DiscoverPage'
import { PeoplePage } from './pages/PeoplePage'
import { StartPage } from './pages/StartPage'
import { TreePage } from './pages/TreePage'
import { AuthProvider, useAuth } from './state/AuthContext'
import { TreeProvider, useTree } from './state/TreeContext'

function Routed() {
  const { account, loading: authLoading } = useAuth()
  const { trees, data, loading: treeLoading } = useTree()

  if (authLoading) return <Spinner label="Getting things ready…" />
  if (!account) return <AuthPage />
  if (treeLoading) return <Spinner label="Opening your family…" />

  // No tree, or a tree with nobody in it: the guided start rather than a blank
  // canvas, which is where this kind of app usually loses people.
  if (!trees.length || !data || data.people.length === 0) {
    return (
      <AppShell>
        <StartPage />
      </AppShell>
    )
  }

  return (
    <Routes>
      <Route
        path="/"
        element={
          <AppShell bare>
            <TreePage />
          </AppShell>
        }
      />
      <Route
        path="/people"
        element={
          <AppShell>
            <PeoplePage />
          </AppShell>
        }
      />
      <Route
        path="/discover"
        element={
          <AppShell>
            <DiscoverPage />
          </AppShell>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <TreeProvider>
          <Routed />
        </TreeProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
