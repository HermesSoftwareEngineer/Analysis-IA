import { Link } from 'react-router-dom'

function Navbar() {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-sm font-bold text-white">
            AF
          </span>
          <div>
            <p className="font-heading text-lg font-semibold text-slate-900">Imobi Analytics</p>
            <p className="text-xs text-slate-500">Financeiro inteligente</p>
          </div>
        </Link>

        <nav className="flex items-center gap-3">
          <Link
            to="/login"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
          >
            Login
          </Link>
          <Link
            to="/cadastro"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
          >
            Cadastro
          </Link>
        </nav>
      </div>
    </header>
  )
}

export default Navbar
