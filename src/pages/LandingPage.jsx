import { Link } from 'react-router-dom'
import FeatureCard from '../components/FeatureCard'
import Footer from '../components/Footer'
import Navbar from '../components/Navbar'

const features = [
  {
    title: 'Controle de boletos de inquilinos',
    description:
      'Acompanhe cobrancas, atrasos e recebimentos em um unico lugar, com visao clara de inadimplencia.',
  },
  {
    title: 'Gestao de repasses a proprietarios',
    description:
      'Organize e confira repasses com historico consolidado para evitar divergencias financeiras.',
  },
  {
    title: 'Controle de pagamentos a fornecedores',
    description:
      'Monitore compromissos financeiros com fornecedores e mantenha previsibilidade do fluxo de caixa.',
  },
  {
    title: 'Analise financeira automatizada',
    description:
      'Prepare sua base de dados para dashboards, indicadores e relatorios com decisao orientada por dados.',
  },
]

function LandingPage() {
  return (
    <div className="min-h-screen bg-[#f5f8fa] text-slate-800">
      <Navbar />

      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-24 left-0 h-72 w-72 rounded-full bg-cyan-200/60 blur-3xl" />
        <div className="pointer-events-none absolute right-0 top-16 h-80 w-80 rounded-full bg-amber-100/90 blur-3xl" />

        <div className="relative mx-auto grid w-full max-w-6xl items-center gap-10 px-6 py-20 md:grid-cols-2 md:py-28">
          <div>
            <span className="inline-flex rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-800">
              Plataforma para imobiliarias
            </span>
            <h1 className="mt-5 font-heading text-4xl font-bold leading-tight text-slate-900 md:text-5xl">
              Analise Financeira Inteligente para Imobiliarias
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-600 md:text-lg">
              Centralize boletos, repasses e pagamentos em um sistema unico para facilitar operacao, auditoria e futuras analises financeiras.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/login"
                className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
              >
                Entrar
              </Link>
              <Link
                to="/cadastro"
                className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
              >
                Criar conta
              </Link>
            </div>
          </div>

          <div className="rounded-3xl border border-white/60 bg-white/80 p-7 shadow-xl shadow-slate-200/80 backdrop-blur">
            <p className="text-sm font-semibold text-slate-500">Visao consolidada</p>
            <div className="mt-6 space-y-4">
              <div className="rounded-2xl border border-slate-200 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Boletos recebidos</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">R$ 128.430</p>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Repasses no mes</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">R$ 84.210</p>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Pagamentos aprovados</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">R$ 36.950</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 pb-20">
        <h2 className="font-heading text-3xl font-bold text-slate-900">Recursos principais</h2>
        <p className="mt-3 max-w-2xl text-slate-600">
          Estrutura preparada para centralizar dados financeiros da operacao imobiliaria e evoluir para analises cada vez mais avancadas.
        </p>

        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {features.map((feature) => (
            <FeatureCard key={feature.title} title={feature.title} description={feature.description} />
          ))}
        </div>
      </section>

      <Footer />
    </div>
  )
}

export default LandingPage
