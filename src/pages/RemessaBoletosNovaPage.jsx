import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getCurrentMonthYear, getPreviousMonthYear, MONTH_OPTIONS } from '../lib/monthOptions'
import { createAnaliseBoleto } from '../services/remessaBoletosService'

function RemessaBoletosNovaPage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const current = getCurrentMonthYear()
  const previous = getPreviousMonthYear()

  const [formData, setFormData] = useState({
    nome: '',
    mesFoco: current.month,
    anoFoco: current.year,
    mesComparacao: previous.month,
    anoComparacao: previous.year,
  })
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const yearOptions = useMemo(() => {
    const base = new Date().getFullYear()
    return Array.from({ length: 8 }).map((_, index) => base - 4 + index)
  }, [])

  function updateField(field, value) {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setLoading(true)
    setErrorMessage('')

    try {
      const analise = await createAnaliseBoleto({
        nome: formData.nome.trim(),
        mesFoco: Number(formData.mesFoco),
        anoFoco: Number(formData.anoFoco),
        mesComparacao: Number(formData.mesComparacao),
        anoComparacao: Number(formData.anoComparacao),
        userId: user.id,
      })

      navigate(`/remessa-boletos/${analise.id}/importar`, { replace: true })
    } catch (error) {
      setErrorMessage(error.message || 'Nao foi possivel criar a analise.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="space-y-6">
      <header>
        <h1 className="font-heading text-3xl font-bold text-slate-900">Nova analise</h1>
        <p className="mt-2 text-sm text-slate-600">
          Defina os meses para comparacao e depois importe a planilha de contratos.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="grid gap-5 md:grid-cols-2">
          <div className="md:col-span-2">
            <label htmlFor="nome" className="mb-1 block text-sm font-semibold text-slate-700">
              Nome da analise
            </label>
            <input
              id="nome"
              type="text"
              required
              value={formData.nome}
              onChange={(event) => updateField('nome', event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
              placeholder="Ex: Remessa fevereiro 2026"
            />
          </div>

          <div>
            <label htmlFor="mesFoco" className="mb-1 block text-sm font-semibold text-slate-700">
              Mes de foco
            </label>
            <select
              id="mesFoco"
              value={formData.mesFoco}
              onChange={(event) => updateField('mesFoco', event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            >
              {MONTH_OPTIONS.map((month) => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="anoFoco" className="mb-1 block text-sm font-semibold text-slate-700">
              Ano de foco
            </label>
            <select
              id="anoFoco"
              value={formData.anoFoco}
              onChange={(event) => updateField('anoFoco', event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="mesComparacao" className="mb-1 block text-sm font-semibold text-slate-700">
              Mes de comparacao
            </label>
            <select
              id="mesComparacao"
              value={formData.mesComparacao}
              onChange={(event) => updateField('mesComparacao', event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            >
              {MONTH_OPTIONS.map((month) => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="anoComparacao" className="mb-1 block text-sm font-semibold text-slate-700">
              Ano de comparacao
            </label>
            <select
              id="anoComparacao"
              value={formData.anoComparacao}
              onChange={(event) => updateField('anoComparacao', event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
        </div>

        {errorMessage ? (
          <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {errorMessage}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={loading}
            className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? 'Salvando...' : 'Salvar e continuar'}
          </button>
          <Link
            to="/remessa-boletos"
            className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
          >
            Cancelar
          </Link>
        </div>
      </form>
    </section>
  )
}

export default RemessaBoletosNovaPage
