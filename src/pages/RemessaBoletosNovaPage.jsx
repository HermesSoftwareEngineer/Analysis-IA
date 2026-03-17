import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { createAnaliseBoleto } from '../services/remessaBoletosService'

function RemessaBoletosNovaPage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = String(now.getMonth() + 1).padStart(2, '0')
  const lastDayFoco = new Date(currentYear, now.getMonth() + 1, 0).getDate()
  const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth()
  const prevYear = now.getMonth() === 0 ? currentYear - 1 : currentYear
  const lastDayComp = new Date(prevYear, prevMonth, 0).getDate()

  const [formData, setFormData] = useState({
    nome: '',
    dataInicioFoco: `${currentYear}-${currentMonth}-01`,
    dataFimFoco: `${currentYear}-${currentMonth}-${String(lastDayFoco).padStart(2, '0')}`,
    dataInicioComparacao: `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`,
    dataFimComparacao: `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(lastDayComp).padStart(2, '0')}`,
  })
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

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
        dataInicioFoco: formData.dataInicioFoco,
        dataFimFoco: formData.dataFimFoco,
        dataInicioComparacao: formData.dataInicioComparacao,
        dataFimComparacao: formData.dataFimComparacao,
        userId: user.id,
      })

      const analiseRef = analise.numero ?? analise.id
      navigate(`/remessa-boletos/${analiseRef}/importar`, { replace: true })
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
          Defina os periodos de foco e comparacao e depois importe a planilha de contratos.
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
            <label htmlFor="dataInicioFoco" className="mb-1 block text-sm font-semibold text-slate-700">
              Periodo de foco — data de inicio
            </label>
            <input
              id="dataInicioFoco"
              type="date"
              required
              value={formData.dataInicioFoco}
              onChange={(event) => updateField('dataInicioFoco', event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            />
          </div>

          <div>
            <label htmlFor="dataFimFoco" className="mb-1 block text-sm font-semibold text-slate-700">
              Periodo de foco — data de fim
            </label>
            <input
              id="dataFimFoco"
              type="date"
              required
              value={formData.dataFimFoco}
              onChange={(event) => updateField('dataFimFoco', event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            />
          </div>

          <div>
            <label htmlFor="dataInicioComparacao" className="mb-1 block text-sm font-semibold text-slate-700">
              Periodo de comparacao — data de inicio
            </label>
            <input
              id="dataInicioComparacao"
              type="date"
              required
              value={formData.dataInicioComparacao}
              onChange={(event) => updateField('dataInicioComparacao', event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            />
          </div>

          <div>
            <label htmlFor="dataFimComparacao" className="mb-1 block text-sm font-semibold text-slate-700">
              Periodo de comparacao — data de fim
            </label>
            <input
              id="dataFimComparacao"
              type="date"
              required
              value={formData.dataFimComparacao}
              onChange={(event) => updateField('dataFimComparacao', event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            />
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
