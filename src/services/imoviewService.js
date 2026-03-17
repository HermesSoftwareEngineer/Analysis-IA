const IMOVIEW_BASE_URL = 'https://api.imoview.com.br'
import { sanitizeText } from '../lib/textSanitizer'

const DEFAULT_IMOVIEW_TIMEOUT_MS = 35000
const DEFAULT_IMOVIEW_MAX_PAGES = 80
const MONEY_EPSILON = 0.005
const SUBTOTAL_DEBUG_ENABLED =
  String(import.meta.env.VITE_REMESSA_SUBTOTAL_DEBUG ?? 'true').trim().toLowerCase() !== 'false'
const SUBTOTAL_DEBUG_CONTRATO = String(import.meta.env.VITE_REMESSA_SUBTOTAL_DEBUG_CONTRATO ?? '').trim()

function shouldLogSubtotalDebug(context, codigoContrato) {
  if (!SUBTOTAL_DEBUG_ENABLED) {
    return false
  }

  if (!SUBTOTAL_DEBUG_CONTRATO) {
    return true
  }

  const byContrato = String(codigoContrato ?? '').includes(SUBTOTAL_DEBUG_CONTRATO)
  const byContext = String(context?.codigoContrato ?? '').includes(SUBTOTAL_DEBUG_CONTRATO)
  return byContrato || byContext
}

function logSubtotalDebug(event, payload, context, codigoContrato) {
  if (!shouldLogSubtotalDebug(context, codigoContrato)) {
    return
  }

  console.warn(`[SubtotalDebug] ${event}`, payload)
}

function resolveImoviewTimeoutMs() {
  const parsed = Number.parseInt(import.meta.env.VITE_IMOVIEW_TIMEOUT_MS ?? '', 10)
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed
  }

  return DEFAULT_IMOVIEW_TIMEOUT_MS
}

function resolveImoviewMaxPages() {
  const parsed = Number.parseInt(import.meta.env.VITE_IMOVIEW_MAX_PAGES ?? '', 10)
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed
  }

  return DEFAULT_IMOVIEW_MAX_PAGES
}

function buildPageFingerprint(lista) {
  if (!Array.isArray(lista) || !lista.length) {
    return 'empty'
  }

  const first = lista[0] ?? {}
  const last = lista[lista.length - 1] ?? {}

  const keyFrom = (item) =>
    [
      item?.codigo,
      item?.codigocontratoaluguel,
      item?.datavencimento,
      item?.datapagamento,
      item?.saldo,
      item?.valor,
    ]
      .map((part) => String(part ?? ''))
      .join('|')

  return `${lista.length}|${keyFrom(first)}|${keyFrom(last)}`
}

async function requestImoview(path, params, headers) {
  const url = `${IMOVIEW_BASE_URL}${path}?${new URLSearchParams(params).toString()}`
  const timeoutMs = resolveImoviewTimeoutMs()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort()
  }, timeoutMs)

  let response

  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...headers,
      },
      signal: controller.signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Imoview timeout apos ${timeoutMs}ms em ${path}.`)
    }

    throw error
  } finally {
    clearTimeout(timeoutId)
  }

  if (!response.ok) {
    const bodyText = await response.text()
    throw new Error(`Imoview retornou erro ${response.status}: ${bodyText || 'sem detalhes'}`)
  }

  return response.json()
}

function parseCurrency(value) {
  if (value === null || value === undefined || value === '') {
    return 0
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }

  let source = String(value).trim()
  if (!source) {
    return 0
  }

  let isNegative = false
  if (/^\(.*\)$/.test(source)) {
    isNegative = true
    source = source.slice(1, -1)
  }

  source = source.replace(/[^\d,.-]/g, '')
  if (!source) {
    return 0
  }

  const hasComma = source.includes(',')
  const hasDot = source.includes('.')

  let normalized = source
  if (hasComma && hasDot) {
    normalized = source.lastIndexOf(',') > source.lastIndexOf('.')
      ? source.replace(/\./g, '').replace(',', '.')
      : source.replace(/,/g, '')
  } else if (hasComma) {
    normalized = source.replace(/\./g, '').replace(',', '.')
  } else {
    normalized = source.replace(/,/g, '')
  }

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) {
    return 0
  }

  return isNegative ? -Math.abs(parsed) : parsed
}

function toCents(value) {
  return Math.round(parseCurrency(value) * 100)
}

function sumValuesInCents(values) {
  if (!Array.isArray(values) || !values.length) {
    return 0
  }

  return values.reduce((acc, value) => acc + toCents(value), 0)
}

function isNearlyZero(value) {
  return Math.abs(parseCurrency(value)) < MONEY_EPSILON
}

function resolveMovimentoValor(...candidates) {
  let hasZeroValue = false

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]
    if (candidate === null || candidate === undefined || String(candidate).trim() === '') {
      continue
    }

    const parsed = parseCurrency(candidate)
    if (parsed !== 0) {
      return parsed
    }

    hasZeroValue = true
  }

  return hasZeroValue ? 0 : 0
}

function resolveMovimentoValorFromObject(source, { allowSaldo = true } = {}) {
  if (!source || typeof source !== 'object') {
    return 0
  }

  const entries = Object.entries(source)

  for (let index = 0; index < entries.length; index += 1) {
    const [key, rawValue] = entries[index]
    if (rawValue === null || rawValue === undefined || rawValue === '') {
      continue
    }

    const normalizedKey = String(key)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()

    const keyLooksLikeValue =
      normalizedKey.includes('valor') || (allowSaldo && normalizedKey.includes('saldo'))

    if (!keyLooksLikeValue) {
      continue
    }

    if (normalizedKey.includes('codigo') || normalizedKey.includes('codig')) {
      continue
    }

    const parsed = parseCurrency(rawValue)
    if (parsed !== 0) {
      return parsed
    }
  }

  return 0
}

function pickValueLikeFields(source) {
  if (!source || typeof source !== 'object') {
    return {}
  }

  const out = {}
  const entries = Object.entries(source)
  for (let index = 0; index < entries.length; index += 1) {
    const [key, rawValue] = entries[index]
    const normalizedKey = String(key)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()

    if (normalizedKey.includes('valor') || normalizedKey.includes('saldo')) {
      out[key] = rawValue
    }
  }

  return out
}

function normalizeCode(value) {
  if (value === null || value === undefined) {
    return ''
  }

  const raw = sanitizeText(value)
  if (!raw) {
    return ''
  }

  if (/^\d+\.0+$/.test(raw)) {
    return raw.split('.')[0]
  }

  return raw
}

function toIsoDate(value) {
  if (!value) {
    return null
  }

  const source = String(value).trim()

  if (/^\d{4}-\d{2}-\d{2}/.test(source)) {
    return source.slice(0, 10)
  }

  const match = source.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (match) {
    return `${match[3]}-${match[2]}-${match[1]}`
  }

  return null
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
  const valor = parseCurrency(movimento?.valor).toFixed(2)
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

function normalizeTipoCliente(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function isLocatarioTipoCliente(value) {
  const tipo = normalizeTipoCliente(value)
  if (!tipo) {
    return false
  }

  return tipo.includes('locatario') || tipo.includes('inquilino')
}

function isoToBrDate(isoDate) {
  if (!isoDate) {
    return ''
  }

  const [year, month, day] = String(isoDate).slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}

export async function fetchMovimentosImoview({ codigoContrato, dataInicial, dataFinal }) {
  const apiKey = import.meta.env.VITE_IMOVIEW_API_KEY

  if (!apiKey) {
    throw new Error('Defina VITE_IMOVIEW_API_KEY no arquivo .env para consultar a API do Imoview.')
  }

  const contractCode = String(codigoContrato ?? '').trim()
  if (!contractCode) {
    throw new Error('Codigo de contrato ausente para consultar movimentos no Imoview.')
  }

  const dataInicialBr = isoToBrDate(dataInicial)
  const dataFinalBr = isoToBrDate(dataFinal)
  const headers = { chave: apiKey }
  const PAGE_SIZE = 1000
  const MAX_PAGES = resolveImoviewMaxPages()

  const params = {
    numeroRegistros: String(PAGE_SIZE),
    codigoContratoAluguel: contractCode,
    dataVencimentoInicial: dataInicialBr,
    dataVencimentoFinal: dataFinalBr,
  }

  console.debug('[Imoview] fetchMovimentosImoview →', { codigoContrato: contractCode, dataInicial, dataFinal })

  const allItems = []
  let page = 1
  let hasMore = true
  let repeatedPageCount = 0
  let previousFingerprint = ''
  let totalFromApi = null

  while (hasMore) {
    const response = await requestImoview(
      '/Movimento/RetornarMovimentos',
      { ...params, numeroPagina: String(page) },
      headers,
    )
    const lista = Array.isArray(response?.lista) ? response.lista : []
    const quantidadeApi = Number(response?.quantidade)
    if (Number.isFinite(quantidadeApi) && quantidadeApi >= 0) {
      totalFromApi = quantidadeApi
    }

    if (page === 1) console.debug('[Imoview] página 1 resposta →', { quantidade: response?.quantidade, listaLength: lista.length, primeiroItem: lista[0] ?? null })

    const currentFingerprint = buildPageFingerprint(lista)
    if (currentFingerprint === previousFingerprint) {
      repeatedPageCount += 1
    } else {
      repeatedPageCount = 0
    }
    previousFingerprint = currentFingerprint

    allItems.push(...lista)

    if (lista.length === 0) {
      hasMore = false
    } else if (totalFromApi !== null && allItems.length >= totalFromApi) {
      hasMore = false
    } else if (repeatedPageCount >= 1) {
      // Protege contra pagina repetida em loop infinito para contratos especificos.
      hasMore = false
      console.warn('[Imoview] pagina repetida detectada; encerrando paginacao para evitar travamento.', {
        codigoContrato: contractCode,
        page,
        listaLength: lista.length,
      })
    } else if (page >= MAX_PAGES) {
      hasMore = false
      console.warn('[Imoview] limite maximo de paginas atingido; encerrando paginacao.', {
        codigoContrato: contractCode,
        page,
        maxPages: MAX_PAGES,
      })
    } else {
      hasMore = lista.length >= PAGE_SIZE
    }

    page += 1
  }

  console.debug('[Imoview] total itens recebidos →', allItems.length)

  return {
    quantidade: allItems.length,
    lista: allItems,
    requestMeta: {
      codigoContratoAluguel: contractCode,
      dataInicial: dataInicialBr,
      dataFinal: dataFinalBr,
    },
  }
}

export function normalizeMovimentosPayload(response, context = {}) {
  const lista = Array.isArray(response?.lista) ? response.lista : []

  const first = lista[0]
  const codigoContrato =
    normalizeCode(first?.codigocontratoaluguel) || String(context.codigoContrato ?? '')
  const codigoImovel = normalizeCode(first?.codigoimovel) || String(context.codigoImovel ?? '')
  const locatario = sanitizeText(first?.nomecliente ?? '')

  // Filtro estrito pelo intervalo de datas do periodo consultado.
  const rangeStart = context.dataInicio ? new Date(context.dataInicio + 'T00:00:00') : null
  const rangeEnd = context.dataFim ? new Date(context.dataFim + 'T23:59:59') : null

  function isWithinRange(isoDate) {
    if (!rangeStart || !rangeEnd) {
      return true
    }
    if (!isoDate) {
      return false
    }
    const d = new Date(isoDate + 'T00:00:00')
    return d >= rangeStart && d <= rangeEnd
  }

  const movimentosRaw = lista.flatMap((item) => {
    const datavenc = toIsoDate(item.datavencimento)
    const datapagto = toIsoDate(item.datapagamento)
    const detalhes = Array.isArray(item.detalhes) ? item.detalhes : []
    const tipoCliente = item?.tipocliente

    // A API pode retornar movimentos de fornecedor no mesmo contrato;
    // aqui garantimos que somente movimentos de locatario entram na analise.
    if (!isLocatarioTipoCliente(tipoCliente)) {
      return []
    }

    if (!isWithinRange(datavenc)) {
      return []
    }

    if (!detalhes.length) {
      return [{
        codigo: String(item.codigo ?? ''),
        historico: sanitizeText(item.historico ?? ''),
        valor: resolveMovimentoValor(
          item.saldo,
          item.valor,
          item.valortotal,
          item.valorTotal,
          item.valorliquido,
          item.valorLiquido,
          resolveMovimentoValorFromObject(item, { allowSaldo: true }),
        ),
        data_vencimento: datavenc,
        data_pagamento: datapagto,
        dados_json: item,
      }]
    }

    return detalhes.map((detalhe) => {
      const valorDetalhe = resolveMovimentoValor(
        detalhe.valor,
        detalhe.valordetalhe,
        detalhe.valorDetalhe,
        detalhe.saldo,
        detalhe.valorliquido,
        detalhe.valorLiquido,
        detalhe.valorbruto,
        detalhe.valorBruto,
        resolveMovimentoValorFromObject(detalhe, { allowSaldo: true }),
      )

      const valorFallbackItem = detalhes.length === 1
        ? resolveMovimentoValor(
            item.saldo,
            item.valor,
            item.valortotal,
            item.valorTotal,
            item.valorliquido,
            item.valorLiquido,
            resolveMovimentoValorFromObject(item, { allowSaldo: true }),
          )
        : 0

      return {
        codigo: String(detalhe.codigodetalhe ?? item.codigo ?? ''),
        historico: sanitizeText(detalhe.descricao ?? item.historico ?? ''),
        valor: valorDetalhe !== 0 ? valorDetalhe : valorFallbackItem,
        data_vencimento: datavenc,
        data_pagamento: datapagto,
        dados_json: detalhe,
      }
    })
  })

  const movimentos = dedupeMovimentos(movimentosRaw)
  let subtotal = sumValuesInCents(movimentos.map((movimento) => movimento?.valor)) / 100
  const subtotalFromLista = sumValuesInCents(
    lista.map((item) =>
      resolveMovimentoValor(
        item.saldo,
        item.valor,
        item.valortotal,
        item.valorTotal,
        item.valorliquido,
        item.valorLiquido,
        resolveMovimentoValorFromObject(item, { allowSaldo: true }),
      ),
    ),
  ) / 100

  if (movimentos.length > 0) {
    logSubtotalDebug(
      'normalize-summary',
      {
        codigoContrato,
        codigoImovel,
        listaCount: lista.length,
        movimentosCount: movimentos.length,
        subtotal,
        subtotalFromLista,
      },
      context,
      codigoContrato,
    )
  }

  // Protecao para casos em que ha movimentos, mas todos os detalhes vieram zerados na API.
  if (movimentos.length > 0 && isNearlyZero(subtotal)) {
    logSubtotalDebug(
      'movements-with-zero-subtotal:before-fallback',
      {
        codigoContrato,
        codigoImovel,
        movimentosCount: movimentos.length,
        listaCount: lista.length,
        subtotal,
        subtotalFromLista,
        sampleMovimentos: movimentos.slice(0, 3).map((movimento) => ({
          codigo: movimento?.codigo,
          valor: movimento?.valor,
          valueFields: pickValueLikeFields(movimento?.dados_json),
        })),
        sampleItens: lista.slice(0, 2).map((item) => ({
          codigo: item?.codigo,
          saldo: item?.saldo,
          valor: item?.valor,
          valueFields: pickValueLikeFields(item),
        })),
      },
      context,
      codigoContrato,
    )

    const fallbackSubtotal = subtotalFromLista

    if (!isNearlyZero(fallbackSubtotal)) {
      subtotal = fallbackSubtotal

      logSubtotalDebug(
        'movements-with-zero-subtotal:fallback-applied',
        {
          codigoContrato,
          codigoImovel,
          movimentosCount: movimentos.length,
          fallbackSubtotal,
        },
        context,
        codigoContrato,
      )

      if (movimentos.length === 1 && isNearlyZero(movimentos[0].valor)) {
        movimentos[0] = {
          ...movimentos[0],
          valor: fallbackSubtotal,
        }
      }
    } else {
      logSubtotalDebug(
        'movements-with-zero-subtotal:fallback-still-zero',
        {
          codigoContrato,
          codigoImovel,
          movimentosCount: movimentos.length,
          listaCount: lista.length,
          sampleItens: lista.slice(0, 3).map((item) => ({
            codigo: item?.codigo,
            valueFields: pickValueLikeFields(item),
            detalhes: Array.isArray(item?.detalhes)
              ? item.detalhes.slice(0, 2).map((detalhe) => pickValueLikeFields(detalhe))
              : [],
          })),
        },
        context,
        codigoContrato,
      )
    }
  }

  return {
    codigoContrato,
    codigoImovel,
    locatario,
    locador: '',
    subtotal,
    movimentos,
    dadosJson: response,
  }
}

export async function pesquisarClientePorCpf(cpf) {
  const apiKey = import.meta.env.VITE_IMOVIEW_API_KEY
  const codigoAcesso = import.meta.env.VITE_IMOVIEW_CODIGO_ACESSO
  const codigoUsuario = import.meta.env.VITE_IMOVIEW_CODIGO_USUARIO || '7'

  if (!apiKey || !codigoAcesso) {
    throw new Error(
      'Defina VITE_IMOVIEW_API_KEY e VITE_IMOVIEW_CODIGO_ACESSO no arquivo .env.',
    )
  }

  const cpfDigits = String(cpf ?? '').replace(/\D/g, '')
  const searchText = cpfDigits || String(cpf ?? '').trim()

  const payload = await requestImoview(
    '/Cliente/App_PesquisarCliente',
    { codigoUsuario, textoPesquisa: searchText },
    { chave: apiKey, codigoacesso: codigoAcesso },
  )

  const lista = Array.isArray(payload?.lista) ? payload.lista : []
  if (!lista.length) {
    return null
  }

  return {
    codigoCliente: String(lista[0].codigo),
    nome: sanitizeText(lista[0].nome ?? ''),
    cpf: lista[0].cpfoucnpj ?? cpf,
  }
}
