function ModulePage({ title, description }) {
  return (
    <section className="space-y-3">
      <h1 className="font-heading text-3xl font-bold text-slate-900">{title}</h1>
      <p className="max-w-2xl text-sm text-slate-600">{description}</p>
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-sm text-slate-500">
        Modulo em construcao.
      </div>
    </section>
  )
}

export default ModulePage
