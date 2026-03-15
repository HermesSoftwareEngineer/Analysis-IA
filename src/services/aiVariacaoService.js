import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { LangChainTracer } from '@langchain/core/tracers/tracer_langchain'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { Client as LangSmithClient } from 'langsmith'

const DEFAULT_PROVIDER = 'google'
const DEFAULT_MODEL = 'gemini-2.0-flash'
const DEFAULT_MAX_OUTPUT_TOKENS = 1400
const EPSILON = 0.005

function asNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatCurrency(value) {
  const normalized = asNumber(value)
  return normalized.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function getMaxOutputTokens() {
  const raw = String(import.meta.env.VITE_AI_MAX_OUTPUT_TOKENS ?? '').trim()
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_OUTPUT_TOKENS
  }

  return Math.floor(parsed)
}

function buildMovimentoFingerprint(movimento) {
  const codigo = normalizeText(
    movimento?.codigo ?? movimento?.dados_json?.codigodetalhe ?? movimento?.dados_json?.codigo ?? '',
  )
  const historico = normalizeText(movimento?.historico ?? '').toLowerCase()
  const vencimento = normalizeText(movimento?.data_vencimento ?? '')
  const pagamento = normalizeText(movimento?.data_pagamento ?? '')
  const valor = asNumber(movimento?.valor).toFixed(2)

  return `${codigo}|${historico}|${vencimento}|${pagamento}|${valor}`
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

function mapMovimentosToPrompt(movimentos = [], maxItems = 80) {
  const unique = dedupeMovimentos(movimentos).slice(0, maxItems)

  if (!unique.length) {
    return '(sem movimentos)'
  }

  return unique
    .map((movimento, index) => {
      const historico = normalizeText(movimento?.historico ?? '-')
      const dataVencimento = normalizeText(movimento?.data_vencimento ?? '-') || '-'
      const dataPagamento = normalizeText(movimento?.data_pagamento ?? '-') || '-'
      const codigo = normalizeText(movimento?.codigo ?? '-') || '-'
      const valor = formatCurrency(movimento?.valor)

      return `${index + 1}. codigo=${codigo}; historico=${historico}; venc=${dataVencimento}; pag=${dataPagamento}; valor=${valor}`
    })
    .join('\n')
}

function extractMessageText(response) {
  if (!response) {
    return ''
  }

  if (typeof response.content === 'string') {
    return response.content.trim()
  }

  if (Array.isArray(response.content)) {
    return response.content
      .map((part) => {
        if (typeof part === 'string') {
          return part
        }

        if (part && typeof part === 'object' && typeof part.text === 'string') {
          return part.text
        }

        return ''
      })
      .join('\n')
      .trim()
  }

  return ''
}

function isPossiblyTruncated(text) {
  const normalized = String(text ?? '').trim()
  if (!normalized) {
    return true
  }

  const words = normalized.split(/\s+/).filter(Boolean).length
  const lines = normalized.split(/\n+/).filter((line) => line.trim().length > 0).length
  const endsAbruptly = /\b(periodo|mes|movimento|valor|contrato|comparacao)\s*\d*$/i.test(normalized)

  return words < 25 || lines < 2 || endsAbruptly
}

function isLangSmithEnabled() {
  return String(import.meta.env.VITE_LANGSMITH_TRACING ?? '')
    .trim()
    .toLowerCase() === 'true'
}

function buildLangSmithCallbacks() {
  if (!isLangSmithEnabled()) {
    return []
  }

  const apiKey = String(import.meta.env.VITE_LANGSMITH_API_KEY ?? '').trim()
  if (!apiKey) {
    return []
  }

  const endpoint = String(import.meta.env.VITE_LANGSMITH_ENDPOINT ?? '').trim() || undefined
  const projectName = String(import.meta.env.VITE_LANGSMITH_PROJECT ?? '').trim() || 'analysis-ia'

  const client = new LangSmithClient({
    apiKey,
    apiUrl: endpoint,
  })

  const tracer = new LangChainTracer({
    projectName,
    client,
  })

  return [tracer]
}

function createChatModel() {
  const provider = String(import.meta.env.VITE_AI_PROVIDER ?? DEFAULT_PROVIDER)
    .trim()
    .toLowerCase()

  if (provider !== 'google') {
    throw new Error(`Provider de IA nao suportado: ${provider}. Configure VITE_AI_PROVIDER=google.`)
  }

  const model = String(import.meta.env.VITE_AI_MODEL ?? DEFAULT_MODEL).trim()
  const apiKey = String(import.meta.env.VITE_GOOGLE_API_KEY ?? '').trim()

  if (!apiKey) {
    throw new Error('Defina VITE_GOOGLE_API_KEY no arquivo .env para usar Analise com IA.')
  }

  return new ChatGoogleGenerativeAI({
    apiKey,
    model,
    temperature: 0.1,
    maxOutputTokens: getMaxOutputTokens(),
  })
}

export function hasDifference(row) {
  return Math.abs(asNumber(row?.difference)) > EPSILON
}

export async function analisarVariacaoContratoComIA({ analise, row, observacaoUsuario = '' }) {
  if (!analise || !row?.contrato) {
    throw new Error('Dados insuficientes para analise de variacao com IA.')
  }

  if (!hasDifference(row)) {
    return ''
  }

  const contrato = row.contrato
  const movimentosFocoText = mapMovimentosToPrompt(row.movimentosFoco)
  const movimentosComparacaoText = mapMovimentosToPrompt(row.movimentosComparacao)
  const observacaoPrompt = normalizeText(observacaoUsuario)

  const model = createChatModel()

  const systemMessage = new SystemMessage(
    'Voce e um analista financeiro especializado em carteira de alugueis. ' +
      'Explique variacoes de valor de forma objetiva, sem inventar fatos. ' +
      'Baseie-se apenas nos movimentos recebidos.',
  )

  const humanMessage = new HumanMessage([
    'Analise a variacao entre dois periodos de um contrato de aluguel.',
    '',
    `Analise: ${normalizeText(analise.nome) || '-'}`,
    `Contrato: ${normalizeText(contrato.codigo_contrato) || '-'}`,
    `Locatario: ${normalizeText(contrato.locatario) || '-'}`,
    `Locador: ${normalizeText(contrato.locador) || '-'}`,
    `Periodo comparacao: ${analise.mes_comparacao}/${analise.ano_comparacao}`,
    `Periodo foco: ${analise.mes_foco}/${analise.ano_foco}`,
    `Subtotal comparacao: ${formatCurrency(row.subtotalComparacao)}`,
    `Subtotal foco: ${formatCurrency(row.subtotalFoco)}`,
    `Diferenca (foco - comparacao): ${formatCurrency(row.difference)}`,
    '',
    'Movimentos do periodo de comparacao:',
    movimentosComparacaoText,
    '',
    'Movimentos do periodo de foco:',
    movimentosFocoText,
    ...(observacaoPrompt
      ? [
          '',
          'Observacao adicional do usuario para direcionar a analise:',
          observacaoPrompt,
        ]
      : []),
    '',
    'Regras da resposta:',
    '1) Responda em portugues do Brasil.',
    '2) Seja direta e curta.',
    '3) Entregue no maximo 3 bullets.',
    '4) Cite somente os movimentos mais relevantes (historico + valor).',
    '5) Limite total entre 40 e 90 palavras.',
    '6) Se faltar dado para concluir, diga "dados insuficientes" em uma linha.',
    '7) Nao invente movimentacoes.',
  ].join('\n'))

  const callbacks = buildLangSmithCallbacks()
  const invokeConfig = {
    runName: 'analise_variacao_remessa',
    metadata: {
      analiseId: String(analise.id ?? ''),
      contratoId: String(contrato.id ?? ''),
      contratoCodigo: String(contrato.codigo_contrato ?? ''),
    },
    ...(callbacks.length ? { callbacks } : {}),
  }

  const baseMessages = [systemMessage, humanMessage]
  let response = await model.invoke(baseMessages, invokeConfig)
  let text = extractMessageText(response)

  if (isPossiblyTruncated(text)) {
    response = await model.invoke(
      [
        ...baseMessages,
        new HumanMessage(
          'A resposta anterior ficou truncada. Reescreva de forma direta, mantendo os bullets e o limite de palavras solicitado.',
        ),
      ],
      invokeConfig,
    )
    text = extractMessageText(response)
  }

  if (!text) {
    throw new Error('A IA nao retornou texto para este contrato.')
  }

  return text
}
