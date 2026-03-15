import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import ExtratoMovimentosTable from '../components/ExtratoMovimentosTable'
import { formatCurrency } from '../lib/currency'
import {
  getCurrentMonthYear,
  getMonthLabel,
  getPreviousMonthYear,
  MONTH_OPTIONS,
} from '../lib/monthOptions'
import { parseContractsFromSpreadsheet } from '../lib/spreadsheetParser'
import { fetchMovimentosImoview, normalizeMovimentosPayload } from '../services/imoviewService'

function getPeriodoLabel(mes, ano) {
  return `${getMonthLabel(mes)} / ${ano}`
}

function getDifferenceClass(difference) {
  if (difference > 0) return 'text-emerald-700'
  if (difference < 0) return 'text-rose-700'
  return 'text-slate-500'
}

function buildQuickKey(contract) {
  return `${contract.codigoCliente}|${contract.codigoContrato}|${contract.codigoImovel}`
}

function resolveQuickConcurrency() {
  const raw = Number(import.meta.env.VITE_REMESSA_RAPIDA_CONCURRENCY ?? 10)
  if (!Number.isFinite(raw)) {
    return 6
  }

  return Math.max(1, Math.min(20, Math.floor(raw)))
}

async function runWithConcurrency(items, concurrency, worker) {
  if (!items.length) {
    return []
  }

  const results = new Array(items.length)
  let cursor = 0

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const currentIndex = cursor
      cursor += 1

      if (currentIndex >= items.length) {
        return
      }

      results[currentIndex] = await worker(items[currentIndex], currentIndex)
    }
  })

  await Promise.all(runners)
  return results
}

async function fetchPeriodoNormalized({ contrato, mes, ano }) {
  const response = await fetchMovimentosImoview({
    codigoContrato: contrato.codigoContrato,
    mes,
    ano,
  })

  return normalizeMovimentosPayload(response, {
    codigoContrato: contrato.codigoContrato,
    codigoImovel: contrato.codigoImovel,
    mes,
    ano,
  })
}

function RemessaBoletosRapidaPage() {
  const current = getCurrentMonthYear()
  const previous = getPreviousMonthYear()

  const [formData, setFormData] = useState({
    mesFoco: current.month,
    anoFoco: current.year,
    mesComparacao: previous.month,
    anoComparacao: previous.year,
  })
  const [selectedFile, setSelectedFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ processed: 0, total: 0, current: '' })
  const [statusMessage, setStatusMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [rows, setRows] = useState([])
  const [search, setSearch] = useState('')
  const [expandedRows, setExpandedRows] = useState(new Set())

  const yearOptions = useMemo(() => {
    const base = new Date().getFullYear()
    return Array.from({ length: 8 }).map((_, index) => base - 4 + index)
  }, [])

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) {
      return rows
    }

    return rows.filter((row) =>
      (row.contrato.codigo_contrato ?? '').toLowerCase().includes(query) ||
      (row.contrato.locatario ?? '').toLowerCase().includes(query) ||
      (row.contrato.locador ?? '').toLowerCase().includes(query),
    )
  }, [rows, search])

  const isAllExpanded =
    filteredRows.length > 0 &&
    filteredRows.every((row) => expandedRows.has(row.key))

  function updateField(field, value) {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }))
  }

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

    setExpandedRows(new Set(filteredRows.map((row) => row.key)))
  }

  async function handleFileChange(event) {
    const file = event.target.files?.[0]
    setSelectedFile(file ?? null)
    setPreview(null)
    setRows([])
    setExpandedRows(new Set())
    setStatusMessage('')
    setErrorMessage('')

    if (!file) {
      return
    }

    setLoadingPreview(true)
    try {
      const parsed = await parseContractsFromSpreadsheet(file, {
        mesFoco: Number(formData.mesFoco),
        anoFoco: Number(formData.anoFoco),
      })
      setPreview(parsed)
    } catch (error) {
      setErrorMessage(error.message || 'Nao foi possivel ler a planilha enviada.')
    } finally {
      setLoadingPreview(false)
    }
  }

  async function handleRunQuickAnalysis() {
    const contracts = preview?.contracts ?? []
    if (!contracts.length) {
      return
    }

    setRunning(true)
    setStatusMessage('')
    setErrorMessage('')
    setRows([])
    setExpandedRows(new Set())

    const mesFoco = Number(formData.mesFoco)
    const anoFoco = Number(formData.anoFoco)
    const mesComparacao = Number(formData.mesComparacao)
    const anoComparacao = Number(formData.anoComparacao)
    const concurrency = resolveQuickConcurrency()

    const totalIterations = contracts.length * 2
    let processed = 0
    let failedContracts = 0
    const bumpProgress = (current) => {
      processed += 1
      setProgress({ processed, total: totalIterations, current })
    }

    const nextRows = await runWithConcurrency(contracts, concurrency, async (contrato) => {
      const contratoLabel = contrato.codigoContrato || contrato.codigoCliente

      const [focoResult, comparacaoResult] = await Promise.allSettled([
        fetchPeriodoNormalized({
          contrato,
          mes: mesFoco,
          ano: anoFoco,
        }).finally(() => bumpProgress(contratoLabel)),
        fetchPeriodoNormalized({
          contrato,
          mes: mesComparacao,
          ano: anoComparacao,
        }).finally(() => bumpProgress(contratoLabel)),
      ])

      const focoNormalized = focoResult.status === 'fulfilled' ? focoResult.value : null
      const comparacaoNormalized = comparacaoResult.status === 'fulfilled' ? comparacaoResult.value : null
      const hasError = focoResult.status === 'rejected' || comparacaoResult.status === 'rejected'

      if (hasError) {
        failedContracts += 1
      }

      const subtotalFoco = Number(focoNormalized?.subtotal ?? 0)
      const subtotalComparacao = Number(comparacaoNormalized?.subtotal ?? 0)

      return {
        key: buildQuickKey(contrato),
        contrato: {
          codigo_contrato: String(contrato.codigoContrato ?? ''),
          codigo_cliente: String(contrato.codigoCliente ?? ''),
          codigo_imovel: String(contrato.codigoImovel ?? ''),
          locatario: focoNormalized?.locatario || comparacaoNormalized?.locatario || contrato.locatario || '',
          locador: contrato.locador || '',
        },
        subtotalFoco,
        subtotalComparacao,
        difference: subtotalFoco - subtotalComparacao,
        movimentosFoco: focoNormalized?.movimentos ?? [],
        movimentosComparacao: comparacaoNormalized?.movimentos ?? [],
      }
    })

    setRows(nextRows.sort((a, b) => b.difference - a.difference))

    if (failedContracts > 0) {
      setErrorMessage(`Analise rapida finalizada com ${failedContracts} contrato(s) com falha em ao menos um periodo.`)
    }

    setStatusMessage(
      `Remessa rapida concluida: ${contracts.length - failedContracts} contrato(s) carregado(s)${failedContracts ? ` e ${failedContracts} com falha.` : '.'} (concorrencia ${concurrency}).`,
    )

    setRunning(false)
  }

  return (
    <section className="space-y-6">
      <header>
        <h1 className="font-heading text-3xl font-bold text-slate-900">Remessa rapida</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          Consulta rapida para conferencia de detalhes. Esta tela nao salva analise, contratos ou movimentos no banco.
        </p>
      </header>

      <div className="rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-900">
        Modo sem persistencia: os dados ficam apenas nesta sessao do navegador.
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">Mes de foco</label>
            <select
              value={formData.mesFoco}
              onChange={(event) => updateField('mesFoco', event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            >
              {MONTH_OPTIONS.map((month) => (
                <option key={month.value} value={month.value}>{month.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">Ano de foco</label>
            <select
              value={formData.anoFoco}
              onChange={(event) => updateField('anoFoco', event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">Mes de comparacao</label>
            <select
              value={formData.mesComparacao}
              onChange={(event) => updateField('mesComparacao', event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            >
              {MONTH_OPTIONS.map((month) => (
                <option key={month.value} value={month.value}>{month.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">Ano de comparacao</label>
            <select
              value={formData.anoComparacao}
              onChange={(event) => updateField('anoComparacao', event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="quickFileUpload" className="mb-1 block text-sm font-semibold text-slate-700">
            Upload da planilha de contratos (.xls ou .xlsx)
          </label>
          <input
            id="quickFileUpload"
            type="file"
            accept=".xls,.xlsx"
            onChange={handleFileChange}
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
          />
          <p className="mt-2 text-xs text-slate-500">
            Utiliza o mesmo parser da importacao oficial, apenas sem gravacao em banco.
          </p>
          {selectedFile ? (
            <p className="mt-2 text-xs text-slate-600">Arquivo selecionado: {selectedFile.name}</p>
          ) : null}
        </div>

        {loadingPreview ? (
          <p className="text-sm text-slate-600">Lendo planilha...</p>
        ) : null}

        {preview ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <p>Contratos identificados: <span className="font-semibold">{preview.contracts.length}</span></p>
            <p>Linhas ignoradas: <span className="font-semibold">{preview.skippedRows}</span></p>
            <p>Ignorados por situacao/regra: <span className="font-semibold">{preview.skippedByStatusRule ?? 0}</span></p>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleRunQuickAnalysis}
            disabled={running || !preview?.contracts?.length}
            className="rounded-xl bg-cyan-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {running ? 'Consultando API...' : 'Carregar dados da API'}
          </button>
          <Link
            to="/remessa-boletos"
            className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
          >
            Voltar para remessas
          </Link>
        </div>
      </div>

      {errorMessage ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</p>
      ) : null}

      {statusMessage ? (
        <p className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-800">{statusMessage}</p>
      ) : null}

      {running ? (
        <p className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-800">
          Processando API em tempo real: {progress.processed}/{progress.total}
          {progress.current ? ` - Contrato ${progress.current}` : ''}
        </p>
      ) : null}

      {rows.length ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por contrato, locatario ou locador"
                className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
              />
              <button
                type="button"
                onClick={toggleExpandAll}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
              >
                {isAllExpanded ? 'Recolher todos' : 'Expandir todos'}
              </button>
              <span className="text-xs text-slate-500">{filteredRows.length} contrato(s)</span>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Codigo Contrato</th>
                    <th className="px-4 py-3 font-semibold">Locatario</th>
                    <th className="px-4 py-3 font-semibold">Locador</th>
                    <th className="px-4 py-3 font-semibold">{getPeriodoLabel(formData.mesFoco, formData.anoFoco)}</th>
                    <th className="px-4 py-3 font-semibold">{getPeriodoLabel(formData.mesComparacao, formData.anoComparacao)}</th>
                    <th className="px-4 py-3 font-semibold">Diferenca</th>
                    <th className="px-4 py-3 font-semibold">Acoes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {!filteredRows.length ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                        Nenhum contrato encontrado para os filtros aplicados.
                      </td>
                    </tr>
                  ) : null}

                  {filteredRows.map((row) => {
                    const isExpanded = expandedRows.has(row.key)

                    return (
                      <Fragment key={row.key}>
                        <tr className="cursor-pointer hover:bg-slate-50/70" onClick={() => toggleExpandRow(row.key)}>
                          <td className="px-4 py-3 font-semibold text-slate-900">{row.contrato.codigo_contrato || '-'}</td>
                          <td className="px-4 py-3">{row.contrato.locatario || '-'}</td>
                          <td className="px-4 py-3">{row.contrato.locador || '-'}</td>
                          <td className="px-4 py-3">{formatCurrency(row.subtotalFoco)}</td>
                          <td className="px-4 py-3">{formatCurrency(row.subtotalComparacao)}</td>
                          <td className={`px-4 py-3 font-semibold ${getDifferenceClass(row.difference)}`}>
                            {formatCurrency(row.difference)}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-500">
                            {isExpanded ? 'Recolher' : 'Expandir'}
                          </td>
                        </tr>

                        {isExpanded ? (
                          <tr>
                            <td colSpan={7} className="bg-slate-50 px-4 py-4">
                              <div className="grid gap-4 md:grid-cols-2">
                                <ExtratoMovimentosTable
                                  title={`Mes de comparacao (${getPeriodoLabel(formData.mesComparacao, formData.anoComparacao)})`}
                                  subtotal={row.subtotalComparacao}
                                  externalUrl=""
                                  movimentos={row.movimentosComparacao}
                                />

                                <ExtratoMovimentosTable
                                  title={`Mes de foco (${getPeriodoLabel(formData.mesFoco, formData.anoFoco)})`}
                                  subtotal={row.subtotalFoco}
                                  externalUrl=""
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
        </div>
      ) : null}
    </section>
  )
}

export default RemessaBoletosRapidaPage
