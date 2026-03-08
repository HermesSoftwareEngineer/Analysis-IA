import { Link } from 'react-router-dom'

function AuthLayout({ title, subtitle, children, footerText, footerLinkText, footerLinkTo }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-100">
      <div className="pointer-events-none absolute -left-24 top-0 h-72 w-72 rounded-full bg-cyan-200/50 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-40 h-80 w-80 rounded-full bg-amber-100/70 blur-3xl" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-6 py-12">
        <div className="w-full max-w-md rounded-3xl border border-white/60 bg-white/90 p-8 shadow-xl shadow-slate-200/70 backdrop-blur">
          <Link to="/" className="text-sm font-semibold text-slate-500 transition hover:text-slate-800">
            Voltar para inicio
          </Link>

          <h1 className="mt-4 font-heading text-3xl font-bold text-slate-900">{title}</h1>
          <p className="mt-2 text-sm text-slate-600">{subtitle}</p>

          <div className="mt-8">{children}</div>

          <p className="mt-6 text-center text-sm text-slate-500">
            {footerText}{' '}
            <Link to={footerLinkTo} className="font-semibold text-slate-800 hover:text-cyan-700">
              {footerLinkText}
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

export default AuthLayout
