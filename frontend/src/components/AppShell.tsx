import { ChevronDown, LogOut, Moon, Network, Sparkles, Sun, TreeDeciduous, Users } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useTheme } from '../lib/theme'
import { useAuth } from '../state/AuthContext'
import { useTree } from '../state/TreeContext'
import { cx } from './ui'

const NAV = [
  { to: '/', label: 'Tree', icon: Network, end: true },
  { to: '/people', label: 'People', icon: Users, end: false },
  { to: '/discover', label: 'Matches', icon: Sparkles, end: false },
]

export function AppShell({ children, bare }: { children: ReactNode; bare?: boolean }) {
  const { account, signOut, mode } = useAuth()
  const { trees, tree, selectTree, createTree } = useTree()
  const { theme, toggle } = useTheme()
  const [menuOpen, setMenuOpen] = useState(false)
  const [treeMenuOpen, setTreeMenuOpen] = useState(false)
  const navigate = useNavigate()

  return (
    <div className="flex h-full flex-col">
      <header className="z-30 flex shrink-0 items-center gap-2 border-b border-line bg-surface/90 px-3 py-2.5 backdrop-blur sm:px-4">
        <TreeDeciduous size={22} className="shrink-0 text-leaf" />
        <span className="font-display text-lg font-bold tracking-tight">Mizu</span>

        {tree && (
          <div className="relative ml-1 min-w-0">
            <button
              onClick={() => setTreeMenuOpen((o) => !o)}
              onBlur={() => setTimeout(() => setTreeMenuOpen(false), 150)}
              className="flex min-w-0 items-center gap-1 rounded-lg px-2 py-1 text-[13px] font-medium text-muted transition hover:bg-ink/5 hover:text-ink"
            >
              <span className="truncate">{tree.name}</span>
              <ChevronDown size={13} className="shrink-0" />
            </button>
            {treeMenuOpen && (
              <div className="absolute left-0 top-full z-40 mt-1 w-60 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-lift">
                {trees.map((t) => (
                  <button
                    key={t.id}
                    onMouseDown={() => {
                      selectTree(t.id)
                      setTreeMenuOpen(false)
                    }}
                    className={cx(
                      'block w-full truncate px-3 py-2 text-left text-[13px] transition hover:bg-leaf-soft',
                      t.id === tree.id && 'font-semibold text-leaf',
                    )}
                  >
                    {t.name}
                  </button>
                ))}
                <button
                  onMouseDown={() => {
                    setTreeMenuOpen(false)
                    const name = window.prompt('Name this tree', 'Another branch of the family')
                    if (name) void createTree(name).then(() => navigate('/'))
                  }}
                  className="block w-full border-t border-line px-3 py-2 text-left text-[13px] text-muted transition hover:bg-ink/5"
                >
                  Start another tree…
                </button>
              </div>
            )}
          </div>
        )}

        <nav className="ml-auto flex items-center gap-0.5">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition',
                  isActive ? 'bg-leaf-soft text-leaf' : 'text-muted hover:bg-ink/5 hover:text-ink',
                )
              }
            >
              <Icon size={15} />
              <span className="hidden sm:inline">{label}</span>
            </NavLink>
          ))}

          <button onClick={toggle} className="btn-ghost btn-sm ml-1" aria-label="Switch light or dark">
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>

          <div className="relative">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              onBlur={() => setTimeout(() => setMenuOpen(false), 150)}
              className="grid h-8 w-8 place-items-center rounded-full bg-leaf text-[12px] font-bold text-white"
              aria-label="Account"
            >
              {(account?.display_name ?? '?').slice(0, 1).toUpperCase()}
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-40 mt-1 w-60 overflow-hidden rounded-xl border border-line bg-surface shadow-lift">
                <div className="border-b border-line px-3 py-2.5">
                  <p className="truncate text-[13px] font-semibold">{account?.display_name}</p>
                  <p className="truncate text-[11.5px] text-muted">{account?.email}</p>
                </div>
                <div className="border-b border-line px-3 py-2">
                  <p className="text-[11.5px] leading-snug text-muted">
                    {mode === 'cloud'
                      ? 'Signed in to your shared family workspace.'
                      : 'Saved in this browser only. Nothing has left this device.'}
                  </p>
                </div>
                <button
                  onMouseDown={() => void signOut()}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] transition hover:bg-ink/5"
                >
                  <LogOut size={14} /> Sign out
                </button>
              </div>
            )}
          </div>
        </nav>
      </header>

      <main className={cx('min-h-0 flex-1', bare ? '' : 'overflow-y-auto')}>{children}</main>
    </div>
  )
}
