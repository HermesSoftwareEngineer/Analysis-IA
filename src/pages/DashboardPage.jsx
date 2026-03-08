function DashboardPage() {
  return (
    <section className="space-y-6">
      <header>
        <h1 className="font-heading text-3xl font-bold text-slate-900">Dashboard</h1>
        <p className="mt-2 text-sm text-slate-600">
          Espaco preparado para futuros graficos, indicadores e resumos financeiros.
        </p>
      </header>

      <div className="grid gap-5 md:grid-cols-3">
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6">
          <p className="text-sm font-semibold text-slate-700">Graficos</p>
          <p className="mt-2 text-sm text-slate-500">Area reservada para visualizacoes financeiras.</p>
        </div>
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6">
          <p className="text-sm font-semibold text-slate-700">Indicadores</p>
          <p className="mt-2 text-sm text-slate-500">Area reservada para KPIs e metricas de desempenho.</p>
        </div>
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6">
          <p className="text-sm font-semibold text-slate-700">Resumos</p>
          <p className="mt-2 text-sm text-slate-500">Area reservada para consolidacao mensal e analises futuras.</p>
        </div>
      </div>
    </section>
  )
}

export default DashboardPage
