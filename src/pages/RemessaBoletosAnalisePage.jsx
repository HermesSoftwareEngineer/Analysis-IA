import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import ExtratoMovimentosTable from '../components/ExtratoMovimentosTable'
import { useAuth } from '../hooks/useAuth'
import { formatCurrency } from '../lib/currency'
import { getMonthLabel } from '../lib/monthOptions'
import { supabase } from '../lib/supabaseClient'
import {
  coletarExtratosParaAnalise,
  coletarExtratosParaContrato,
  getAnaliseBoletoById,
  loadComparativoAnalise,
  resetContratosSituacao,
  updateContratoSituacao,
  updateContratoStatusObservacao,
} from '../services/remessaBoletosService'

function getPeriodoLabel(mes, ano) {
  return `${getMonthLabel(mes)} / ${ano}`
}

function getDifferenceClass(difference) {
  if (difference > 0) {
    return 'text-emerald-700'
  }

  if (difference < 0) {
    return 'text-rose-700'
  }

  return 'text-slate-500'
}

function buildContractKey(contract) {
  return `${contract.codigo_cliente}|${contract.codigo_contrato}`
}

function findExtratoForPeriodo({ extratos, contrato, mes, ano }) {
  const periodRows = extratos.filter(
    (extrato) => Number(extrato.mes) === Number(mes) && Number(extrato.ano) === Number(ano),
  )

  // Todas as linhas do mesmo cliente nesse periodo
  const clienteRows = periodRows.filter(
    (extrato) => extrato.codigo_cliente === contrato.codigo_cliente,
  )

  if (!clienteRows.length) {
    return null
  }

  // Prefere sempre a linha que realmente possui movimentos
  const withMovimentos = clienteRows.filter(
    (extrato) => (extrato.movimentos_boletos?.length ?? 0) > 0,
  )
  if (withMovimentos.length) {
    // Dentre as que tem movimentos, prefere exact-match de codigo_contrato
    const exact = withMovimentos.find(
      (extrato) =>
        String(extrato.codigo_contrato ?? '').trim() ===
        String(contrato.codigo_contrato ?? '').trim(),
    )

    return exact ?? withMovimentos[0]
  }

  // Nenhuma linha com movimentos — retorna a exact-match ou a primeira
  return (
    clienteRows.find(
      (extrato) =>
        String(extrato.codigo_contrato ?? '').trim() ===
        String(contrato.codigo_contrato ?? '').trim(),
    ) ?? clienteRows[0]
  )
}

function getPayloadList(payload) {
  if (!payload || typeof payload !== 'object') {
    return []
  }

  if (Array.isArray(payload.lista)) {
    return payload.lista
  }

  if (Array.isArray(payload.data)) {
    return payload.data
  }

  if (Array.isArray(payload.dados)) {
    return payload.dados
  }

  return []
}

function extractExternalUrl(dadosJson, contrato) {
  if (!dadosJson || typeof dadosJson !== 'object') {
    return ''
  }

  const lista = getPayloadList(dadosJson)
  const targetContrato = String(contrato.codigo_contrato ?? '').trim()
  const targetImovel = String(contrato.codigo_imovel ?? '').trim()

  const matched = lista.find((item) => {
    const contratoCodigo = String(item?.contratocodigo ?? item?.codigoContrato ?? '').trim()
    const imovelCodigo = String(item?.imovelcodigo ?? item?.codigoImovel ?? '').trim()

    const contratoMatches = targetContrato ? contratoCodigo === targetContrato : true
    const imovelMatches = targetImovel ? imovelCodigo === targetImovel : true

    return contratoMatches && imovelMatches
  })

  return (
    matched?.urlacessoexterno ??
    matched?.urlAcessoExterno ??
    dadosJson?.urlacessoexternotodosimoveis ??
    dadosJson?.urlAcessoExternoTodosImoveis ??
    ''
  )
}

function RemessaBoletosAnalisePage() {
  const { analiseId } = useParams()
  const { user } = useAuth()
  const location = useLocation()

  const [analise, setAnalise] = useState(null)
  const [contratos, setContratos] = useState([])
  const [extratos, setExtratos] = useState([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('') // '' = todos | 'a_conferir' | 'conferido'
  // sortConfig: { column: 'difference'|'contrato'|'locatario'|'locador'|'foco'|'comparacao', dir: 'asc'|'desc' }
  const [sortConfig, setSortConfig] = useState({ column: 'difference', dir: 'desc' })
  // IDs dos contratos atualizados na sessão atual de "Atualizar Valores" (para filtro progressivo)
  const [updatedIds, setUpdatedIds] = useState(new Set())
  const [expandedRows, setExpandedRows] = useState(new Set())
  const [updatingAll, setUpdatingAll] = useState(false)
  const [updatingContractKey, setUpdatingContractKey] = useState('')
  const [batchProgress, setBatchProgress] = useState({ processed: 0, total: 0, currentContract: '' })
  // editingObservacao: { [contratoId]: string } — rascunhos locais antes de salvar
  const [editingObservacao, setEditingObservacao] = useState({})
  // savingKey: key do contrato que está sendo salvo (status ou obs)
  const [savingKey, setSavingKey] = useState('')
  const refreshTimeoutRef = useRef(null)

  const loadData = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) {
        setLoading(true)
      }

      setErrorMessage('')

      try {
        const analiseData = await getAnaliseBoletoById({ analiseId, userId: user.id })
        const comparativo = await loadComparativoAnalise(analiseId)

        setAnalise(analiseData)
        setContratos(comparativo.contratos)
        setExtratos(comparativo.extratos)
      } catch (error) {
        setErrorMessage(error.message || 'Nao foi possivel carregar os dados da analise.')
      } finally {
        if (!silent) {
          setLoading(false)
        }
      }
    },
    [analiseId, user?.id],
  )

  useEffect(() => {
    if (location.state?.importSummary) {
      const summary = location.state.importSummary

      if (summary.failed) {
        setStatusMessage(`Importacao concluida com ${summary.failed} contrato(s) com falha.`)
      } else {
        setStatusMessage('Importacao e coleta de extratos concluida com sucesso.')
      }
    }
  }, [location.state])

  useEffect(() => {
    if (user?.id && analiseId) {
      loadData()
    }
  }, [analiseId, user?.id, loadData])

  const scheduleLiveRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) {
      return
    }

    refreshTimeoutRef.current = setTimeout(() => {
      refreshTimeoutRef.current = null
      loadData({ silent: true })
    }, 350)
  }, [loadData])

  useEffect(() => {
    if (!analiseId || !user?.id) {
      return undefined
    }

    const channel = supabase
      .channel(`remessa_boletos_live_${analiseId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'contratos_analise',
          filter: `analise_id=eq.${analiseId}`,
        },
        scheduleLiveRefresh,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'extratos_boletos',
          filter: `analise_id=eq.${analiseId}`,
        },
        scheduleLiveRefresh,
      )
      .subscribe()

    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current)
        refreshTimeoutRef.current = null
      }

      supabase.removeChannel(channel)
    }
  }, [analiseId, scheduleLiveRefresh, user?.id])

  const rows = useMemo(() => {
    if (!analise) {
      return []
    }

    return contratos.map((contrato) => {
      const focoExtrato = findExtratoForPeriodo({
        extratos,
        contrato,
        mes: analise.mes_foco,
        ano: analise.ano_foco,
      })

      const comparacaoExtrato = findExtratoForPeriodo({
        extratos,
        contrato,
        mes: analise.mes_comparacao,
        ano: analise.ano_comparacao,
      })

      const subtotalFoco = Number(focoExtrato?.subtotal ?? 0)
      const subtotalComparacao = Number(comparacaoExtrato?.subtotal ?? 0)

      return {
        contrato,
        key: buildContractKey(contrato),
        focoExtrato,
        comparacaoExtrato,
        subtotalFoco,
        subtotalComparacao,
        difference: subtotalFoco - subtotalComparacao,
        movimentosFoco: focoExtrato?.movimentos_boletos ?? [],
        movimentosComparacao: comparacaoExtrato?.movimentos_boletos ?? [],
        externalUrlFoco: extractExternalUrl(focoExtrato?.dados_json, contrato),
        externalUrlComparacao: extractExternalUrl(comparacaoExtrato?.dados_json, contrato),
      }
    })
  }, [analise, contratos, extratos])

  const filteredAndSortedRows = useMemo(() => {
    const query = search.trim().toLowerCase()

    const textFiltered = !query
      ? rows
      : rows.filter(
          (row) =>
            row.contrato.codigo_contrato?.toLowerCase().includes(query) ||
            row.contrato.locatario?.toLowerCase().includes(query) ||
            row.contrato.locador?.toLowerCase().includes(query),
        )

    // Filtro por status
    const statusFiltered = statusFilter
      ? textFiltered.filter((row) => (row.contrato.status ?? 'a_conferir') === statusFilter)
      : textFiltered

    // Durante Atualizar Valores: exibe apenas contratos já atualizados nesta sessão
    const filtered = updatingAll
      ? statusFiltered.filter((row) => updatedIds.has(row.contrato.id))
      : statusFiltered

    const { column, dir } = sortConfig
    const sign = dir === 'asc' ? 1 : -1

    return [...filtered].sort((a, b) => {
      switch (column) {
        case 'contrato':
          return sign * (a.contrato.codigo_contrato ?? '').localeCompare(b.contrato.codigo_contrato ?? '')
        case 'locatario':
          return sign * (a.contrato.locatario ?? '').localeCompare(b.contrato.locatario ?? '')
        case 'locador':
          return sign * (a.contrato.locador ?? '').localeCompare(b.contrato.locador ?? '')
        case 'foco':
          return sign * (a.subtotalFoco - b.subtotalFoco)
        case 'comparacao':
          return sign * (a.subtotalComparacao - b.subtotalComparacao)
        case 'difference':
        default:
          return sign * (a.difference - b.difference)
      }
    })
  }, [rows, search, statusFilter, sortConfig, updatingAll, updatedIds])

  const isAllExpanded =
    filteredAndSortedRows.length > 0 &&
    filteredAndSortedRows.every((row) => expandedRows.has(row.key))

  function toggleExpandRow(rowKey) {
    setExpandedRows((prev) => {
      const next = new Set(prev)

      if (next.has(rowKey)) {
        next.delete(rowKey)
      } else {
        next.add(rowKey)
      }

      return next
    })
  }

  function toggleExpandAll() {
    if (isAllExpanded) {
      setExpandedRows(new Set())
      return
    }

    setExpandedRows(new Set(filteredAndSortedRows.map((row) => row.key)))
  }

  function handleSort(column) {
    setSortConfig((prev) =>
      prev.column === column
        ? { column, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { column, dir: 'asc' },
    )
  }

  function getSortIndicator(column) {
    if (sortConfig.column !== column) return ' ↕'
    return sortConfig.dir === 'asc' ? ' ↑' : ' ↓'
  }

  async function handleUpdateAll() {
    if (!analise || !contratos.length) {
      return
    }

    setUpdatingAll(true)
    setStatusMessage('')
    setErrorMessage('')
    setBatchProgress({ processed: 0, total: contratos.length, currentContract: '' })

    // Reseta situação localmente e no banco antes de iniciar
    setUpdatedIds(new Set())
    setContratos((prev) => prev.map((c) => ({ ...c, situacao: 'desatualizado' })))
    try {
      await resetContratosSituacao(analise.id)
    } catch {
      // não bloqueia o processo se o reset falhar
    }

    try {
      const result = await coletarExtratosParaAnalise({
        analise,
        contratos,
        onProgress: ({ processed, total, contrato, periodo, success }) => {
          const contractLabel = contrato.codigo_contrato || contrato.codigo_cliente
          const periodoLabel = `${periodo.mes}/${periodo.ano}`

          // Marca como atualizado quando o último período do contrato é processado
          if (periodo.mes === analise.mes_comparacao && periodo.ano === analise.ano_comparacao) {
            setUpdatedIds((prev) => new Set([...prev, contrato.id]))
            setContratos((prev) =>
              prev.map((c) => (c.id === contrato.id ? { ...c, situacao: 'atualizado' } : c)),
            )
            updateContratoSituacao({ contratoId: contrato.id, situacao: 'atualizado' }).catch(() => {})
          }

          setBatchProgress({ processed, total, currentContract: contractLabel })
          setStatusMessage(
            success
              ? `Atualizando contrato ${contractLabel} no periodo ${periodoLabel} (${processed}/${total})...`
              : `Contrato ${contractLabel} com falha no periodo ${periodoLabel} (${processed}/${total}).`,
          )

          loadData({ silent: true })
        },
      })

      if (result.failed) {
        setStatusMessage(`Atualizacao concluida com ${result.failed} falha(s).`)
      } else {
        setStatusMessage('Atualizacao de todos os contratos concluida.')
      }

      await loadData({ silent: true })
    } catch (error) {
      setErrorMessage(error.message || 'Nao foi possivel atualizar todos os contratos.')
    } finally {
      setBatchProgress({ processed: 0, total: 0, currentContract: '' })
      setUpdatingAll(false)
      setUpdatedIds(new Set())
    }
  }

  async function handleUpdateSingle(contrato) {
    if (!analise) {
      return
    }

    const rowKey = buildContractKey(contrato)
    setUpdatingContractKey(rowKey)
    setStatusMessage('')
    setErrorMessage('')

    try {
      const result = await coletarExtratosParaContrato({
        analise,
        contrato,
        continueOnError: true,
        onIteration: ({ periodo, iterationIndex, totalIterations, success }) => {
          const periodLabel = `${periodo.mes}/${periodo.ano}`

          setStatusMessage(
            success
              ? `Atualizando contrato ${contrato.codigo_contrato || contrato.codigo_cliente} em ${periodLabel} (${iterationIndex}/${totalIterations})...`
              : `Falha ao atualizar contrato ${contrato.codigo_contrato || contrato.codigo_cliente} em ${periodLabel} (${iterationIndex}/${totalIterations}).`,
          )

          loadData({ silent: true })
        },
      })

      if (result.failedIterations > 0) {
        setErrorMessage(
          `Contrato ${contrato.codigo_contrato || contrato.codigo_cliente} finalizou com ${result.failedIterations} falha(s).`,
        )
      } else {
        setStatusMessage(`Contrato ${contrato.codigo_contrato || contrato.codigo_cliente} atualizado.`)
      }

      updateContratoSituacao({ contratoId: contrato.id, situacao: 'atualizado' }).catch(() => {})
      setContratos((prev) =>
        prev.map((c) => (c.id === contrato.id ? { ...c, situacao: 'atualizado' } : c)),
      )
      await loadData({ silent: true })
    } catch (error) {
      setErrorMessage(error.message || 'Nao foi possivel atualizar o contrato selecionado.')
    } finally {
      setUpdatingContractKey('')
    }
  }

  async function handleStatusChange(contrato, newStatus) {
    const rowKey = buildContractKey(contrato)
    setSavingKey(rowKey)
    try {
      await updateContratoStatusObservacao({
        contratoId: contrato.id,
        status: newStatus,
        observacao: contrato.observacao ?? '',
      })
      setContratos((prev) =>
        prev.map((c) => (c.id === contrato.id ? { ...c, status: newStatus } : c)),
      )
    } finally {
      setSavingKey('')
    }
  }

  async function handleObservacaoSave(contrato) {
    const rowKey = buildContractKey(contrato)
    const novaObs = editingObservacao[contrato.id] ?? contrato.observacao ?? ''
    setSavingKey(rowKey)
    try {
      await updateContratoStatusObservacao({
        contratoId: contrato.id,
        status: contrato.status ?? 'a_conferir',
        observacao: novaObs,
      })
      setContratos((prev) =>
        prev.map((c) => (c.id === contrato.id ? { ...c, observacao: novaObs } : c)),
      )
      setEditingObservacao((prev) => {
        const next = { ...prev }
        delete next[contrato.id]
        return next
      })
    } finally {
      setSavingKey('')
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-600">Carregando analise...</p>
  }

  if (!analise) {
    return (
      <section className="space-y-4">
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Analise nao encontrada.
        </p>
        <Link
          to="/remessa-boletos"
          className="inline-flex rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
        >
          Voltar
        </Link>
      </section>
    )
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-bold text-slate-900">{analise.nome}</h1>
          <p className="mt-2 text-sm text-slate-600">
            Comparacao de {getPeriodoLabel(analise.mes_comparacao, analise.ano_comparacao)} com{' '}
            {getPeriodoLabel(analise.mes_foco, analise.ano_foco)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            to={`/remessa-boletos/${analise.id}/importar`}
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
          >
            Importar planilha
          </Link>
          <button
            type="button"
            onClick={handleUpdateAll}
            disabled={updatingAll || !contratos.length}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {updatingAll ? 'Atualizando...' : 'Atualizar valores'}
          </button>
        </div>
      </header>

      <div className="flex flex-wrap gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por contrato, locatario ou locador"
          className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-xl border border-slate-300 px-3 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
        >
          <option value="">Todos os status</option>
          <option value="a_conferir">A conferir</option>
          <option value="conferido">Conferido</option>
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={toggleExpandAll}
          className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
        >
          {isAllExpanded ? 'Recolher todos' : 'Expandir todos'}
        </button>
        <span className="text-xs text-slate-500">{filteredAndSortedRows.length} contrato(s) listados</span>
      </div>

      {errorMessage ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</p>
      ) : null}

      {statusMessage ? (
        <p className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-800">{statusMessage}</p>
      ) : null}

      {updatingAll ? (
        <p className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-800">
          Processando extratos em tempo real: {batchProgress.processed}/{batchProgress.total}
          {batchProgress.currentContract ? ` - Contrato ${batchProgress.currentContract}` : ''}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th
                  className="cursor-pointer select-none px-4 py-3 font-semibold hover:text-slate-800"
                  onClick={() => handleSort('contrato')}
                >
                  Codigo Contrato{getSortIndicator('contrato')}
                </th>
                <th
                  className="cursor-pointer select-none px-4 py-3 font-semibold hover:text-slate-800"
                  onClick={() => handleSort('locatario')}
                >
                  Locatario{getSortIndicator('locatario')}
                </th>
                <th
                  className="cursor-pointer select-none px-4 py-3 font-semibold hover:text-slate-800"
                  onClick={() => handleSort('locador')}
                >
                  Locador{getSortIndicator('locador')}
                </th>
                <th
                  className="cursor-pointer select-none px-4 py-3 font-semibold hover:text-slate-800"
                  onClick={() => handleSort('foco')}
                >
                  {getPeriodoLabel(analise.mes_foco, analise.ano_foco)}{getSortIndicator('foco')}
                </th>
                <th
                  className="cursor-pointer select-none px-4 py-3 font-semibold hover:text-slate-800"
                  onClick={() => handleSort('comparacao')}
                >
                  {getPeriodoLabel(analise.mes_comparacao, analise.ano_comparacao)}{getSortIndicator('comparacao')}
                </th>
                <th
                  className="cursor-pointer select-none px-4 py-3 font-semibold hover:text-slate-800"
                  onClick={() => handleSort('difference')}
                >
                  Diferenca{getSortIndicator('difference')}
                </th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Acoes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {!filteredAndSortedRows.length ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    {updatingAll
                      ? 'Aguardando contratos serem atualizados...'
                      : 'Nenhum contrato encontrado para os filtros aplicados.'}
                  </td>
                </tr>
              ) : null}

              {filteredAndSortedRows.map((row) => {
                const isExpanded = expandedRows.has(row.key)
                const contrato = row.contrato
                const obsRascunho = editingObservacao[contrato.id] ?? contrato.observacao ?? ''
                const obsModificada = editingObservacao[contrato.id] !== undefined &&
                  editingObservacao[contrato.id] !== (contrato.observacao ?? '')
                const isSaving = savingKey === row.key

                return (
                  <Fragment key={row.key}>
                    <tr
                      className="cursor-pointer hover:bg-slate-50/70"
                      onClick={() => toggleExpandRow(row.key)}
                    >
                      <td className="px-4 py-3 font-semibold text-slate-900">{contrato.codigo_contrato || '-'}</td>
                      <td className="px-4 py-3">{contrato.locatario || '-'}</td>
                      <td className="px-4 py-3">{contrato.locador || '-'}</td>
                      <td className="px-4 py-3">{formatCurrency(row.subtotalFoco)}</td>
                      <td className="px-4 py-3">{formatCurrency(row.subtotalComparacao)}</td>
                      <td className={`px-4 py-3 font-semibold ${getDifferenceClass(row.difference)}`}>
                        {formatCurrency(row.difference)}
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <select
                          value={contrato.status ?? 'a_conferir'}
                          disabled={isSaving}
                          onChange={(e) => handleStatusChange(contrato, e.target.value)}
                          className={`rounded-lg border px-2 py-1 text-xs font-semibold outline-none transition ${
                            (contrato.status ?? 'a_conferir') === 'conferido'
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                              : 'border-amber-300 bg-amber-50 text-amber-800'
                          }`}
                        >
                          <option value="a_conferir">A conferir</option>
                          <option value="conferido">Conferido</option>
                        </select>
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => handleUpdateSingle(contrato)}
                          disabled={updatingContractKey === row.key}
                          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {updatingContractKey === row.key ? 'Atualizando...' : 'Atualizar contrato'}
                        </button>
                      </td>
                    </tr>

                    {isExpanded ? (
                      <tr>
                        <td colSpan={8} className="bg-slate-50 px-4 py-4">
                          <div className="mb-4 flex flex-wrap items-end gap-4">
                            <div className="flex flex-1 flex-col gap-1">
                              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Observacao</label>
                              <div className="flex items-center gap-1">
                                <input
                                  type="text"
                                  value={obsRascunho}
                                  disabled={isSaving}
                                  onChange={(e) =>
                                    setEditingObservacao((prev) => ({
                                      ...prev,
                                      [contrato.id]: e.target.value,
                                    }))
                                  }
                                  onKeyDown={(e) => e.key === 'Enter' && obsModificada && handleObservacaoSave(contrato)}
                                  placeholder="Sem observacao"
                                  className="w-64 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs outline-none transition focus:border-cyan-400 focus:ring-1 focus:ring-cyan-100"
                                />
                                {obsModificada ? (
                                  <button
                                    type="button"
                                    disabled={isSaving}
                                    onClick={() => handleObservacaoSave(contrato)}
                                    className="rounded-lg bg-slate-900 px-2 py-1 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-70"
                                  >
                                    ✓
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          </div>

                          <div className="grid gap-4 md:grid-cols-2">
                            <ExtratoMovimentosTable
                              title={`Mes de comparacao (${getPeriodoLabel(analise.mes_comparacao, analise.ano_comparacao)})`}
                              subtotal={row.subtotalComparacao}
                              externalUrl={row.externalUrlComparacao}
                              movimentos={row.movimentosComparacao}
                            />

                            <ExtratoMovimentosTable
                              title={`Mes de foco (${getPeriodoLabel(analise.mes_foco, analise.ano_foco)})`}
                              subtotal={row.subtotalFoco}
                              externalUrl={row.externalUrlFoco}
                              movimentos={row.movimentosFoco}
                            />
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

export default RemessaBoletosAnalisePage
