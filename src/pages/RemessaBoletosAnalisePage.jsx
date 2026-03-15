import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
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
  updateContratoAnaliseIA,
  resetContratosSituacao,
  updateContratoSituacao,
  updateContratoStatusObservacao,
} from '../services/remessaBoletosService'
import { analisarVariacaoContratoComIA, hasDifference } from '../services/aiVariacaoService'

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

function buildMovimentoFingerprint(movimento) {
  const codigo = String(
    movimento?.codigo ?? movimento?.dados_json?.codigodetalhe ?? movimento?.dados_json?.codigo ?? '',
  ).trim()
  const planoConta = String(
    movimento?.dados_json?.codigoplanoconta ??
      movimento?.dados_json?.codigoPlanoConta ??
      movimento?.dados_json?.nomeplanoconta ??
      '',
  )
    .trim()
    .toLowerCase()
  const historico = String(movimento?.historico ?? '').trim().toLowerCase()
  const valor = Number(movimento?.valor ?? 0).toFixed(2)
  const vencimento = String(movimento?.data_vencimento ?? '').trim()
  const pagamento = String(movimento?.data_pagamento ?? '').trim()

  return `${codigo}|${planoConta}|${historico}|${valor}|${vencimento}|${pagamento}`
}

function dedupeMovimentos(movimentos) {
  if (!Array.isArray(movimentos) || !movimentos.length) {
    return []
  }

  const seen = new Set()
  const unique = []

  for (const movimento of movimentos) {
    const key = buildMovimentoFingerprint(movimento)
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    unique.push(movimento)
  }

  return unique
}

function sumMovimentos(movimentos) {
  return movimentos.reduce((total, movimento) => total + Number(movimento?.valor ?? 0), 0)
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
  const [differenceFilter, setDifferenceFilter] = useState('') // '' | 'com_diferenca' | 'sem_diferenca'
  const [iaAnalysisFilter, setIaAnalysisFilter] = useState('') // '' | 'com_analise_ia' | 'sem_analise_ia'
  const [viewMode, setViewMode] = useState('tabela') // 'tabela' | 'comentarios_ia'
  const [expandedRows, setExpandedRows] = useState(new Set())
  const [updatingAll, setUpdatingAll] = useState(false)
  const [updatingContractKey, setUpdatingContractKey] = useState('')
  const [batchProgress, setBatchProgress] = useState({ processed: 0, total: 0, currentContract: '' })
  const [analyzingAllWithIA, setAnalyzingAllWithIA] = useState(false)
  const [analyzingContractKey, setAnalyzingContractKey] = useState('')
  const [aiProgress, setAiProgress] = useState({ processed: 0, total: 0, currentContract: '' })
  const [analysisModalOpen, setAnalysisModalOpen] = useState(false)
  const [analysisModalScope, setAnalysisModalScope] = useState('all') // 'all' | 'single'
  const [analysisOnlyWithoutIA, setAnalysisOnlyWithoutIA] = useState(false)
  const [analysisPromptNote, setAnalysisPromptNote] = useState('')
  const [analysisTargetKey, setAnalysisTargetKey] = useState('')
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

      const movimentosFoco = dedupeMovimentos(focoExtrato?.movimentos_boletos ?? [])
      const movimentosComparacao = dedupeMovimentos(comparacaoExtrato?.movimentos_boletos ?? [])
      const subtotalFoco = movimentosFoco.length
        ? sumMovimentos(movimentosFoco)
        : Number(focoExtrato?.subtotal ?? 0)
      const subtotalComparacao = movimentosComparacao.length
        ? sumMovimentos(movimentosComparacao)
        : Number(comparacaoExtrato?.subtotal ?? 0)

      return {
        contrato,
        key: buildContractKey(contrato),
        focoExtrato,
        comparacaoExtrato,
        subtotalFoco,
        subtotalComparacao,
        difference: subtotalFoco - subtotalComparacao,
        movimentosFoco,
        movimentosComparacao,
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

    // Filtro por diferença
    const differenceFiltered =
      differenceFilter === 'com_diferenca'
        ? statusFiltered.filter((row) => hasDifference(row))
        : differenceFilter === 'sem_diferenca'
          ? statusFiltered.filter((row) => !hasDifference(row))
          : statusFiltered

    // Filtro por presença de análise da IA
    const iaAnalysisFiltered =
      iaAnalysisFilter === 'com_analise_ia'
        ? differenceFiltered.filter((row) => Boolean(String(row.contrato.analise_ia ?? '').trim()))
        : iaAnalysisFilter === 'sem_analise_ia'
          ? differenceFiltered.filter((row) => !String(row.contrato.analise_ia ?? '').trim())
          : differenceFiltered

    // Durante Atualizar Valores: exibe apenas contratos já atualizados nesta sessão
    const filtered = updatingAll
      ? iaAnalysisFiltered.filter((row) => updatedIds.has(row.contrato.id))
      : iaAnalysisFiltered

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
  }, [rows, search, statusFilter, differenceFilter, iaAnalysisFilter, sortConfig, updatingAll, updatedIds])

  const iaCommentRows = useMemo(() => filteredAndSortedRows, [filteredAndSortedRows])
  const iaRowsWithoutAnalysisCount = useMemo(
    () => iaCommentRows.filter((row) => !String(row.contrato.analise_ia ?? '').trim()).length,
    [iaCommentRows],
  )

  const analysisTargetRow = useMemo(
    () => rows.find((row) => row.key === analysisTargetKey) ?? null,
    [rows, analysisTargetKey],
  )

  const iaMarkdownComponents = useMemo(
    () => ({
      p: ({ ...props }) => (
        <p className="mb-2 last:mb-0" {...props} />
      ),
      h1: ({ ...props }) => (
        <h4 className="mb-2 mt-1 text-sm font-semibold text-slate-800" {...props} />
      ),
      h2: ({ ...props }) => (
        <h4 className="mb-2 mt-1 text-sm font-semibold text-slate-800" {...props} />
      ),
      h3: ({ ...props }) => (
        <h5 className="mb-1.5 mt-1 text-sm font-semibold text-slate-800" {...props} />
      ),
      ul: ({ ...props }) => (
        <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0" {...props} />
      ),
      ol: ({ ...props }) => (
        <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0" {...props} />
      ),
      li: ({ ...props }) => (
        <li className="text-slate-600" {...props} />
      ),
      strong: ({ ...props }) => (
        <strong className="font-semibold text-slate-800" {...props} />
      ),
      em: ({ ...props }) => (
        <em className="italic text-slate-700" {...props} />
      ),
      code: ({ ...props }) => (
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs text-slate-700" {...props} />
      ),
      pre: ({ ...props }) => (
        <pre className="mb-2 overflow-x-auto rounded-lg bg-slate-100 p-2 text-xs text-slate-700" {...props} />
      ),
      blockquote: ({ ...props }) => (
        <blockquote className="mb-2 border-l-2 border-cyan-200 pl-3 text-slate-600" {...props} />
      ),
      a: ({ ...props }) => (
        <a
          className="font-medium text-cyan-700 underline underline-offset-2 hover:text-cyan-800"
          target="_blank"
          rel="noreferrer"
          {...props}
        />
      ),
    }),
    [],
  )

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

  const hasActiveFilters =
    Boolean(search.trim()) ||
    Boolean(statusFilter) ||
    Boolean(differenceFilter) ||
    Boolean(iaAnalysisFilter)

  function handleClearFilters() {
    setSearch('')
    setStatusFilter('')
    setDifferenceFilter('')
    setIaAnalysisFilter('')
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

  function buildIAComentario(texto) {
    const when = new Date().toLocaleString('pt-BR')
    return `Analise IA (${when})\n${String(texto ?? '').trim()}`
  }

  async function persistIAComentario({ contrato, analiseIa }) {
    await updateContratoAnaliseIA({
      contratoId: contrato.id,
      analiseIa,
    })

    setContratos((prev) =>
      prev.map((c) => (c.id === contrato.id ? { ...c, analise_ia: analiseIa } : c)),
    )
  }

  async function handleAnalyzeSingle(row, options = {}) {
    if (!analise || !row?.contrato) {
      return
    }

    const observacaoUsuario = String(options.promptUsuario ?? '').trim()

    if (!hasDifference(row)) {
      setStatusMessage(`Contrato ${row.contrato.codigo_contrato || row.contrato.codigo_cliente} sem diferenca para analise.`)
      return
    }

    setAnalyzingContractKey(row.key)
    setErrorMessage('')
    setStatusMessage('')

    try {
      const resposta = await analisarVariacaoContratoComIA({ analise, row, observacaoUsuario })
      const analiseIa = buildIAComentario(resposta)

      await persistIAComentario({ contrato: row.contrato, analiseIa })
      setStatusMessage(`Analise com IA concluida para contrato ${row.contrato.codigo_contrato || row.contrato.codigo_cliente}.`)
    } catch (error) {
      setErrorMessage(error.message || 'Nao foi possivel analisar este contrato com IA.')
    } finally {
      setAnalyzingContractKey('')
    }
  }

  async function handleAnalyzeAllWithIA(options = {}) {
    if (!analise) {
      return
    }

    const sourceRows = Array.isArray(options.sourceRows) ? options.sourceRows : rows
    const onlyWithoutIA = Boolean(options.onlyWithoutIA)
    const observacaoUsuario = String(options.promptUsuario ?? '').trim()

    const targets = sourceRows
      .filter((row) => hasDifference(row))
      .filter((row) => !onlyWithoutIA || !String(row.contrato.analise_ia ?? '').trim())

    if (!targets.length) {
      setStatusMessage(
        onlyWithoutIA
          ? 'Nao ha contratos sem analise da IA com diferenca para processar.'
          : 'Nao ha contratos com diferenca para analisar com IA.',
      )
      return
    }

    setAnalyzingAllWithIA(true)
    setErrorMessage('')
    setStatusMessage('')
    setAiProgress({ processed: 0, total: targets.length, currentContract: '' })

    let success = 0
    let failed = 0

    for (let index = 0; index < targets.length; index += 1) {
      const row = targets[index]
      const contractLabel = row.contrato.codigo_contrato || row.contrato.codigo_cliente

      setAiProgress({
        processed: index,
        total: targets.length,
        currentContract: contractLabel,
      })
      setStatusMessage(`Analisando com IA o contrato ${contractLabel} (${index + 1}/${targets.length})...`)

      try {
        const resposta = await analisarVariacaoContratoComIA({ analise, row, observacaoUsuario })
        const analiseIa = buildIAComentario(resposta)
        await persistIAComentario({ contrato: row.contrato, analiseIa })
        success += 1
      } catch {
        failed += 1
      }

      setAiProgress({
        processed: index + 1,
        total: targets.length,
        currentContract: contractLabel,
      })
    }

    setAnalyzingAllWithIA(false)
    setAiProgress({ processed: 0, total: 0, currentContract: '' })

    if (failed > 0) {
      setErrorMessage(`Analise com IA finalizada com ${failed} falha(s).`)
    }

    setStatusMessage(
      `Analise com IA concluida: ${success} contrato(s) analisado(s)${failed ? ` e ${failed} falha(s).` : '.'}`,
    )
  }

  function openAnalysisConfigModal({ scope = 'all', row = null } = {}) {
    setAnalysisModalScope(scope)
    setAnalysisOnlyWithoutIA(scope === 'all')
    setAnalysisPromptNote('')
    setAnalysisTargetKey(row?.key ?? '')
    setAnalysisModalOpen(true)
  }

  function closeAnalysisConfigModal() {
    if (analyzingAllWithIA || Boolean(analyzingContractKey)) {
      return
    }
    setAnalysisModalOpen(false)
  }

  async function submitAnalysisConfig() {
    const promptUsuario = analysisPromptNote.trim()

    if (analysisModalScope === 'single') {
      if (!analysisTargetRow) {
        setErrorMessage('Contrato alvo da analise nao encontrado.')
        return
      }

      setAnalysisModalOpen(false)
      await handleAnalyzeSingle(analysisTargetRow, { promptUsuario })
      return
    }

    setAnalysisModalOpen(false)
    await handleAnalyzeAllWithIA({
      onlyWithoutIA: analysisOnlyWithoutIA,
      promptUsuario,
      sourceRows: filteredAndSortedRows,
    })
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
            onClick={() => openAnalysisConfigModal({ scope: 'all' })}
            disabled={analyzingAllWithIA || updatingAll || !rows.some((row) => hasDifference(row))}
            className="rounded-xl border border-cyan-300 bg-cyan-50 px-4 py-2 text-sm font-semibold text-cyan-800 transition hover:border-cyan-400 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {analyzingAllWithIA ? 'Analisando com IA...' : 'Analisar com IA'}
          </button>
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
        <select
          value={differenceFilter}
          onChange={(e) => setDifferenceFilter(e.target.value)}
          className="rounded-xl border border-slate-300 px-3 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
        >
          <option value="">Com e sem diferenca</option>
          <option value="com_diferenca">Com diferenca</option>
          <option value="sem_diferenca">Sem diferenca</option>
        </select>
        <select
          value={iaAnalysisFilter}
          onChange={(e) => setIaAnalysisFilter(e.target.value)}
          className="rounded-xl border border-slate-300 px-3 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
        >
          <option value="">Com e sem analise IA</option>
          <option value="com_analise_ia">Com analise IA</option>
          <option value="sem_analise_ia">Sem analise IA</option>
        </select>
        <button
          type="button"
          onClick={handleClearFilters}
          disabled={!hasActiveFilters}
          className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Limpar filtros
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Visualizacao</span>
        <button
          type="button"
          onClick={() => setViewMode('tabela')}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            viewMode === 'tabela'
              ? 'bg-slate-900 text-white'
              : 'border border-slate-300 bg-white text-slate-700 hover:border-slate-400'
          }`}
        >
          Tabela
        </button>
        <button
          type="button"
          onClick={() => setViewMode('comentarios_ia')}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            viewMode === 'comentarios_ia'
              ? 'bg-cyan-700 text-white'
              : 'border border-cyan-300 bg-cyan-50 text-cyan-800 hover:border-cyan-400 hover:bg-cyan-100'
          }`}
        >
          Comentarios da IA
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {viewMode === 'tabela' ? (
          <button
            type="button"
            onClick={toggleExpandAll}
            className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
          >
            {isAllExpanded ? 'Recolher todos' : 'Expandir todos'}
          </button>
        ) : null}
        <span className="text-xs text-slate-500">
          {viewMode === 'tabela'
            ? `${filteredAndSortedRows.length} contrato(s) listados`
            : `${iaCommentRows.length} contrato(s) na visao IA (${iaRowsWithoutAnalysisCount} sem analise)`}
        </span>
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

      {analyzingAllWithIA ? (
        <p className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-800">
          Processando analise com IA: {aiProgress.processed}/{aiProgress.total}
          {aiProgress.currentContract ? ` - Contrato ${aiProgress.currentContract}` : ''}
        </p>
      ) : null}

      {viewMode === 'tabela' ? (
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
                  const analiseIA = contrato.analise_ia ?? ''
                  const hasIAComentario = Boolean(analiseIA.trim())
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
                          <div className="flex flex-col gap-1">
                            <button
                              type="button"
                              onClick={() => handleUpdateSingle(contrato)}
                              disabled={updatingContractKey === row.key}
                              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
                            >
                              {updatingContractKey === row.key ? 'Atualizando...' : 'Atualizar contrato'}
                            </button>
                            <button
                              type="button"
                              onClick={() => openAnalysisConfigModal({ scope: 'single', row })}
                              disabled={
                                analyzingContractKey === row.key ||
                                analyzingAllWithIA ||
                                !hasDifference(row)
                              }
                              className="rounded-lg border border-cyan-300 bg-cyan-50 px-3 py-1.5 text-xs font-semibold text-cyan-800 transition hover:border-cyan-400 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-70"
                            >
                              {analyzingContractKey === row.key ? 'Analisando IA...' : 'Analisar com IA'}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {isExpanded ? (
                        <tr>
                          <td colSpan={8} className="bg-slate-50 px-4 py-4">
                            <div className="mb-4 space-y-3">
                              {hasIAComentario ? (
                                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                                  <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-cyan-700">
                                    <svg
                                      className="h-4 w-4 text-cyan-600"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="1.8"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      aria-hidden="true"
                                    >
                                      <path d="M12 3l1.6 3.9L17.5 8.5l-3.9 1.6L12 14l-1.6-3.9L6.5 8.5l3.9-1.6L12 3z" />
                                      <path d="M18.5 14l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1z" />
                                      <path d="M6 15.5l.7 1.7 1.8.8-1.8.8-.7 1.7-.8-1.7-1.7-.8 1.7-.8.8-1.7z" />
                                    </svg>
                                    Comentario da IA
                                  </div>
                                  <div className="text-sm leading-relaxed text-slate-600">
                                    <ReactMarkdown
                                      remarkPlugins={[remarkGfm]}
                                      components={iaMarkdownComponents}
                                    >
                                      {analiseIA}
                                    </ReactMarkdown>
                                  </div>
                                </div>
                              ) : null}

                              <div className="flex flex-col gap-1">
                                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Observacao</label>
                                <div className="flex flex-col gap-2">
                                  <textarea
                                    value={obsRascunho}
                                    disabled={isSaving}
                                    onChange={(e) =>
                                      setEditingObservacao((prev) => ({
                                        ...prev,
                                        [contrato.id]: e.target.value,
                                      }))
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && obsModificada) {
                                        handleObservacaoSave(contrato)
                                      }
                                    }}
                                    placeholder="Sem observacao"
                                    className="min-h-24 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-400 focus:ring-1 focus:ring-cyan-100"
                                  />
                                  <div className="flex items-center justify-end gap-2">
                                    <span className="text-[11px] text-slate-500">Salvar: Ctrl+Enter</span>
                                    <button
                                      type="button"
                                      disabled={isSaving || !obsModificada}
                                      onClick={() => handleObservacaoSave(contrato)}
                                      className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
                                    >
                                      Salvar observacao
                                    </button>
                                  </div>
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
      ) : (
        <div className="space-y-3">
          {!iaCommentRows.length ? (
            <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
              Nenhum contrato encontrado para os filtros aplicados.
            </p>
          ) : null}

          {iaCommentRows.map((row) => {
            const contrato = row.contrato
            const analiseIA = String(contrato.analise_ia ?? '')
            const hasIAComentario = Boolean(analiseIA.trim())
            const isSaving = savingKey === row.key

            return (
              <article key={row.key} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-7">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Codigo Contrato</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{contrato.codigo_contrato || '-'}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Locatario</p>
                    <p className="mt-1 text-sm text-slate-700">{contrato.locatario || '-'}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Locador</p>
                    <p className="mt-1 text-sm text-slate-700">{contrato.locador || '-'}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {getPeriodoLabel(analise.mes_foco, analise.ano_foco)}
                    </p>
                    <p className="mt-1 text-sm text-slate-700">{formatCurrency(row.subtotalFoco)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {getPeriodoLabel(analise.mes_comparacao, analise.ano_comparacao)}
                    </p>
                    <p className="mt-1 text-sm text-slate-700">{formatCurrency(row.subtotalComparacao)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Diferenca</p>
                    <p className={`mt-1 text-sm font-semibold ${getDifferenceClass(row.difference)}`}>
                      {formatCurrency(row.difference)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Status</p>
                    <select
                      value={contrato.status ?? 'a_conferir'}
                      disabled={isSaving}
                      onChange={(e) => handleStatusChange(contrato, e.target.value)}
                      className={`mt-1 w-full rounded-lg border px-2 py-1.5 text-xs font-semibold outline-none transition ${
                        (contrato.status ?? 'a_conferir') === 'conferido'
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                          : 'border-amber-300 bg-amber-50 text-amber-800'
                      }`}
                    >
                      <option value="a_conferir">A conferir</option>
                      <option value="conferido">Conferido</option>
                    </select>
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-cyan-700">
                    <svg
                      className="h-4 w-4 text-cyan-600"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M12 3l1.6 3.9L17.5 8.5l-3.9 1.6L12 14l-1.6-3.9L6.5 8.5l3.9-1.6L12 3z" />
                      <path d="M18.5 14l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1z" />
                      <path d="M6 15.5l.7 1.7 1.8.8-1.8.8-.7 1.7-.8-1.7-1.7-.8 1.7-.8.8-1.7z" />
                    </svg>
                    Comentario da IA
                  </div>
                  {hasIAComentario ? (
                    <div className="text-sm leading-relaxed text-slate-600">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={iaMarkdownComponents}
                      >
                        {analiseIA}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">Sem analise da IA</p>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {analysisModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">Configurar analise com IA</h2>
            <p className="mt-1 text-sm text-slate-600">Defina como a analise deve ser executada.</p>

            <div className="mt-4 space-y-3">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Escopo</p>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="ia-escopo"
                    value="all"
                    checked={analysisModalScope === 'all'}
                    onChange={() => setAnalysisModalScope('all')}
                  />
                  Analisar todos os contratos filtrados
                </label>
                {analysisTargetRow ? (
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="ia-escopo"
                      value="single"
                      checked={analysisModalScope === 'single'}
                      onChange={() => setAnalysisModalScope('single')}
                    />
                    Analisar somente o contrato {analysisTargetRow.contrato.codigo_contrato || analysisTargetRow.contrato.codigo_cliente}
                  </label>
                ) : null}
              </div>

              {analysisModalScope === 'all' ? (
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={analysisOnlyWithoutIA}
                    onChange={(e) => setAnalysisOnlyWithoutIA(e.target.checked)}
                  />
                  Analisar somente contratos sem analise da IA
                </label>
              ) : null}

              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Observacao para IA (prompt opcional)</label>
                <textarea
                  value={analysisPromptNote}
                  onChange={(e) => setAnalysisPromptNote(e.target.value)}
                  placeholder="Ex: foque em taxas extras e multas"
                  className="min-h-24 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-400 focus:ring-1 focus:ring-cyan-100"
                />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeAnalysisConfigModal}
                disabled={analyzingAllWithIA || Boolean(analyzingContractKey)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-70"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submitAnalysisConfig}
                disabled={analyzingAllWithIA || Boolean(analyzingContractKey)}
                className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-70"
              >
                Iniciar analise
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

export default RemessaBoletosAnalisePage
