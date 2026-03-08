import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getMonthLabel, MONTH_OPTIONS } from '../lib/monthOptions'
import {
  coletarExtratosParaAnalise,
  deleteAnaliseBoleto,
  getAnaliseBoletoById,
  listAnalisesBoletos,
  listContratosByAnalise,
  updateAnaliseBoleto,
} from '../services/remessaBoletosService'

function formatDate(dateValue) {
  return new Date(dateValue).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function formatPeriodo(month, year) {
  return `${getMonthLabel(month)} / ${year}`
}

function RemessaBoletosPage() {
  const { user } = useAuth()
  const [analises, setAnalises] = useState([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [refreshingId, setRefreshingId] = useState('')
  const [searchTerm, setSearchTerm] = useState('')

  // editar
  const [editingAnalise, setEditingAnalise] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [editLoading, setEditLoading] = useState(false)
  const [editError, setEditError] = useState('')

  // excluir
  const [deletingAnalise, setDeletingAnalise] = useState(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const yearOptions = useMemo(() => {
    const base = new Date().getFullYear()
    return Array.from({ length: 8 }).map((_, i) => base - 4 + i)
  }, [])

  const loadAnalises = useCallback(async () => {
    if (!user?.id) {
      return
    }

    setLoading(true)
    setErrorMessage('')

    try {
      const data = await listAnalisesBoletos(user.id)
      setAnalises(data)
    } catch (error) {
      setErrorMessage(error.message || 'Nao foi possivel carregar as analises.')
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    loadAnalises()
  }, [loadAnalises])

  function openEdit(analise) {
    setEditingAnalise(analise)
    setEditError('')
    setEditForm({
      nome: analise.nome,
      mesFoco: analise.mes_foco,
      anoFoco: analise.ano_foco,
      mesComparacao: analise.mes_comparacao,
      anoComparacao: analise.ano_comparacao,
    })
  }

  async function handleEditSubmit(event) {
    event.preventDefault()
    setEditLoading(true)
    setEditError('')

    try {
      await updateAnaliseBoleto({
        analiseId: editingAnalise.id,
        userId: user.id,
        nome: editForm.nome.trim(),
        mesFoco: Number(editForm.mesFoco),
        anoFoco: Number(editForm.anoFoco),
        mesComparacao: Number(editForm.mesComparacao),
        anoComparacao: Number(editForm.anoComparacao),
      })
      setEditingAnalise(null)
      await loadAnalises()
    } catch (error) {
      setEditError(error.message || 'Nao foi possivel salvar as alteracoes.')
    } finally {
      setEditLoading(false)
    }
  }

  async function handleDelete() {
    setDeleteLoading(true)

    try {
      await deleteAnaliseBoleto({ analiseId: deletingAnalise.id, userId: user.id })
      setDeletingAnalise(null)
      await loadAnalises()
    } catch (error) {
      setErrorMessage(error.message || 'Nao foi possivel excluir a analise.')
      setDeletingAnalise(null)
    } finally {
      setDeleteLoading(false)
    }
  }

  async function handleRefresh(analiseId) {
    setRefreshingId(analiseId)
    setStatusMessage('')

    try {
      const analise = await getAnaliseBoletoById({ analiseId, userId: user.id })
      const contratos = await listContratosByAnalise(analiseId)

      if (!contratos.length) {
        setStatusMessage('A analise selecionada ainda nao possui contratos importados.')
        return
      }

      const result = await coletarExtratosParaAnalise({
        analise,
        contratos,
      })

      if (result.failed) {
        setStatusMessage(`Atualizacao concluida com ${result.failed} contrato(s) com falha.`)
      } else {
        setStatusMessage('Atualizacao concluida com sucesso.')
      }

      await loadAnalises()
    } catch (error) {
      setErrorMessage(error.message || 'Nao foi possivel atualizar os valores da analise.')
    } finally {
      setRefreshingId('')
    }
  }

  const filteredAnalises = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()

    if (!query) {
      return analises
    }

    return analises.filter((analise) => analise.nome.toLowerCase().includes(query))
  }, [analises, searchTerm])

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-bold text-slate-900">Remessa de Boletos</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Compare os extratos de dois meses, identifique inconsistencias e mantenha um historico de auditoria financeira.
          </p>
        </div>

        <Link
          to="/remessa-boletos/nova"
          className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
        >
          Nova analise
        </Link>
      </header>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <input
          type="text"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Buscar analise por nome"
          className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
        />
      </div>

      {errorMessage ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</p>
      ) : null}

      {statusMessage ? (
        <p className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-800">{statusMessage}</p>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Nome da analise</th>
                <th className="px-4 py-3 font-semibold">Mes de foco</th>
                <th className="px-4 py-3 font-semibold">Mes de comparacao</th>
                <th className="px-4 py-3 font-semibold">Contratos</th>
                <th className="px-4 py-3 font-semibold">Criacao</th>
                <th className="px-4 py-3 font-semibold">Acoes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    Carregando analises...
                  </td>
                </tr>
              ) : null}

              {!loading && !filteredAnalises.length ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    Nenhuma analise encontrada.
                  </td>
                </tr>
              ) : null}

              {!loading
                ? filteredAnalises.map((analise) => (
                    <tr key={analise.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-semibold text-slate-900">{analise.nome}</td>
                      <td className="px-4 py-3">{formatPeriodo(analise.mes_foco, analise.ano_foco)}</td>
                      <td className="px-4 py-3">
                        {formatPeriodo(analise.mes_comparacao, analise.ano_comparacao)}
                      </td>
                      <td className="px-4 py-3">{analise.quantidade_contratos}</td>
                      <td className="px-4 py-3">{formatDate(analise.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Link
                            to={`/remessa-boletos/${analise.id}`}
                            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
                          >
                            Abrir
                          </Link>
                          <button
                            type="button"
                            onClick={() => openEdit(analise)}
                            className="rounded-lg border border-cyan-300 bg-cyan-50 px-3 py-1.5 text-xs font-semibold text-cyan-800 transition hover:border-cyan-400 hover:bg-cyan-100"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingAnalise(analise)}
                            className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:border-rose-400 hover:bg-rose-100"
                          >
                            Excluir
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de edição */}
      {editingAnalise ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <h2 className="mb-5 font-heading text-xl font-bold text-slate-900">Editar analise</h2>

            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">Nome</label>
                <input
                  type="text"
                  required
                  value={editForm.nome}
                  onChange={(e) => setEditForm((p) => ({ ...p, nome: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700">Mes de foco</label>
                  <select
                    value={editForm.mesFoco}
                    onChange={(e) => setEditForm((p) => ({ ...p, mesFoco: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
                  >
                    {MONTH_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700">Ano de foco</label>
                  <select
                    value={editForm.anoFoco}
                    onChange={(e) => setEditForm((p) => ({ ...p, anoFoco: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
                  >
                    {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700">Mes de comparacao</label>
                  <select
                    value={editForm.mesComparacao}
                    onChange={(e) => setEditForm((p) => ({ ...p, mesComparacao: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
                  >
                    {MONTH_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700">Ano de comparacao</label>
                  <select
                    value={editForm.anoComparacao}
                    onChange={(e) => setEditForm((p) => ({ ...p, anoComparacao: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
                  >
                    {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>

              {editError ? (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{editError}</p>
              ) : null}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingAnalise(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={editLoading}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-70"
                >
                  {editLoading ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Modal de confirmação de exclusão */}
      {deletingAnalise ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <h2 className="mb-2 font-heading text-lg font-bold text-slate-900">Excluir analise</h2>
            <p className="mb-5 text-sm text-slate-600">
              Tem certeza que deseja excluir <span className="font-semibold">{deletingAnalise.nome}</span>? Todos os contratos, extratos e movimentos vinculados tambem serao removidos.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeletingAnalise(null)}
                disabled={deleteLoading}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteLoading}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-70"
              >
                {deleteLoading ? 'Excluindo...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

export default RemessaBoletosPage
