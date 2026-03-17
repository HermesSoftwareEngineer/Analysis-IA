import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { parseContractsFromSpreadsheet } from '../lib/spreadsheetParser'
import {
  coletarExtratosParaAnalise,
  getAnaliseBoletoByNumero,
  upsertContratosAnalise,
} from '../services/remessaBoletosService'

function formatPeriodo(analise) {
  const fmt = (iso) => {
    if (!iso) return '-'
    const [year, month, day] = iso.slice(0, 10).split('-')
    return `${day}/${month}/${year}`
  }
  return `${fmt(analise.data_inicio_comparacao)} – ${fmt(analise.data_fim_comparacao)} x ${fmt(analise.data_inicio_foco)} – ${fmt(analise.data_fim_foco)}`
}

function RemessaBoletosImportPage() {
  const { analiseNumero } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [analise, setAnalise] = useState(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [selectedFile, setSelectedFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState({ processed: 0, total: 0 })
  const [liveStatus, setLiveStatus] = useState('')

  useEffect(() => {
    async function loadAnalise() {
      setLoading(true)
      setErrorMessage('')

      try {
        const data = await getAnaliseBoletoByNumero({ analiseNumero, userId: user.id })
        setAnalise(data)
      } catch (error) {
        setErrorMessage(error.message || 'Nao foi possivel carregar a analise.')
      } finally {
        setLoading(false)
      }
    }

    if (user?.id && analiseNumero) {
      loadAnalise()
    }
  }, [analiseNumero, user?.id])

  async function handleFileChange(event) {
    const file = event.target.files?.[0]
    setSelectedFile(file ?? null)
    setPreview(null)
    setErrorMessage('')

    if (!file) {
      return
    }

    try {
      const parsed = await parseContractsFromSpreadsheet(file, {
        dataInicioFoco: analise?.data_inicio_foco,
        dataFimFoco: analise?.data_fim_foco,
      })
      setPreview(parsed)
    } catch (error) {
      setErrorMessage(error.message || 'Nao foi possivel ler a planilha enviada.')
    }
  }

  async function handleImport() {
    if (!analise || !preview?.contracts?.length) {
      return
    }

    setImporting(true)
    setErrorMessage('')
    setLiveStatus('Preparando contratos para coleta...')
    setProgress({ processed: 0, total: preview.contracts.length })

    try {
      const contratos = await upsertContratosAnalise(analise.id, preview.contracts)

      const result = await coletarExtratosParaAnalise({
        analise,
        contratos,
        onProgress: ({ processed, total, contrato, periodo, success }) => {
          setProgress({ processed, total })

          const contratoLabel = contrato.codigo_contrato || contrato.codigo_cliente
          const periodoLabel = periodo.tipo
          setLiveStatus(
            success
              ? `Contrato ${contratoLabel} atualizado para ${periodoLabel} (${processed}/${total}).`
              : `Contrato ${contratoLabel} com falha em ${periodoLabel} (${processed}/${total}).`,
          )
        },
      })

      const analiseRef = analise.numero ?? analise.id

      navigate(`/remessa-boletos/${analiseRef}`, {
        replace: true,
        state: {
          importSummary: result,
        },
      })
    } catch (error) {
      setErrorMessage(error.message || 'Nao foi possivel importar e coletar os extratos.')
    } finally {
      setImporting(false)
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-600">Carregando dados da analise...</p>
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
      <header>
        <h1 className="font-heading text-3xl font-bold text-slate-900">Importacao de planilha</h1>
        <p className="mt-2 text-sm text-slate-600">
          Analise: <span className="font-semibold text-slate-800">{analise.nome}</span> ({formatPeriodo(analise)})
        </p>
      </header>

      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <label htmlFor="fileUpload" className="mb-2 block text-sm font-semibold text-slate-700">
          Upload da planilha (.xls ou .xlsx)
        </label>
        <input
          id="fileUpload"
          type="file"
          accept=".xls,.xlsx"
          onChange={handleFileChange}
          className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
        />

        <p className="mt-3 text-xs text-slate-500">
          O parser identifica automaticamente as colunas de codigo do cliente, contrato e imovel.
        </p>

        {selectedFile ? (
          <p className="mt-2 text-xs text-slate-600">Arquivo selecionado: {selectedFile.name}</p>
        ) : null}
      </div>

      {preview ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-slate-800">Resumo da importacao</h2>
          <div className="mt-3 grid gap-3 text-sm text-slate-600 md:grid-cols-2">
            <p>
              Contratos identificados: <span className="font-semibold text-slate-900">{preview.contracts.length}</span>
            </p>
            <p>
              Linhas ignoradas: <span className="font-semibold text-slate-900">{preview.skippedRows}</span>
            </p>
            <p>
              Ignorados por situacao/regra: <span className="font-semibold text-slate-900">{preview.skippedByStatusRule ?? 0}</span>
            </p>
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <p>Colunas detectadas:</p>
            <p className="mt-1">Cliente: {preview.detectedColumns.codigoCliente ?? 'nao detectada'}</p>
            <p>Contrato: {preview.detectedColumns.codigoContrato ?? 'nao detectada'}</p>
            <p>Imovel: {preview.detectedColumns.codigoImovel ?? 'nao detectada'}</p>
            <p>Situacao: {preview.detectedColumns.situacao ?? 'nao detectada'}</p>
            <p>DataRescisao: {preview.detectedColumns.dataRescisao ?? 'nao detectada'}</p>
          </div>
        </div>
      ) : null}

      {errorMessage ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</p>
      ) : null}

      {importing ? (
        <div className="space-y-2 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-800">
          <p>
            Coletando extratos: {progress.processed} / {progress.total}
          </p>
          {liveStatus ? <p className="text-xs text-cyan-900">{liveStatus}</p> : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleImport}
          disabled={importing || !preview?.contracts?.length}
          className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {importing ? 'Importando e coletando...' : 'Importar planilha e coletar extratos'}
        </button>
        <Link
          to={`/remessa-boletos/${analise.numero ?? analise.id}`}
          className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
        >
          Ir para analise
        </Link>
      </div>
    </section>
  )
}

export default RemessaBoletosImportPage
