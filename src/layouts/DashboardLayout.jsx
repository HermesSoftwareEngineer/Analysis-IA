import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

const menuItems = [
  { label: 'Dashboard', path: '/dashboard' },
  { label: 'Boletos', path: '/boletos' },
  { label: 'Repasses', path: '/repasses' },
  { label: 'Pagamentos', path: '/pagamentos' },
  { label: 'Relatorios', path: '/relatorios' },
  { label: 'Remessa de Boletos', path: '/remessa-boletos' },
  { label: 'Configuracoes', path: '/configuracoes' },
]

function DashboardLayout() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    try {
      await signOut()
      navigate('/login', { replace: true })
    } catch (error) {
      console.error(error)
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      <aside className="fixed left-0 top-0 flex h-screen w-72 flex-col border-r border-slate-200 bg-white p-6">
        <Link to="/dashboard" className="mb-8 flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-sm font-bold text-white">
            AF
          </span>
          <div>
            <p className="font-heading text-lg font-semibold text-slate-900">Imobi Analytics</p>
            <p className="text-xs text-slate-500">Painel financeiro</p>
          </div>
        </Link>

        <nav className="flex flex-1 flex-col gap-2">
          {menuItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `rounded-xl px-4 py-3 text-sm font-semibold transition ${
                  isActive
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="truncate text-sm font-semibold text-slate-700">{user?.email}</p>
          <button
            type="button"
            onClick={handleSignOut}
            className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
          >
            Sair
          </button>
        </div>
      </aside>

      <main className="ml-72 min-h-screen p-8">
        <Outlet />
      </main>
    </div>
  )
}

export default DashboardLayout
