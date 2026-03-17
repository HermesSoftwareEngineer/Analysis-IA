const IMOVIEW_BASE_URL = 'https://api.imoview.com.br'
import { sanitizeText } from '../lib/textSanitizer'

async function requestImoview(path, params, headers) {
  const url = `${IMOVIEW_BASE_URL}${path}?${new URLSearchParams(params).toString()}`
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      ...headers,
    },
  })

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

  const normalized = String(value)
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '')

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
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

  while (hasMore) {
    const response = await requestImoview(
      '/Movimento/RetornarMovimentos',
      { ...params, numeroPagina: String(page) },
      headers,
    )
    const lista = Array.isArray(response?.lista) ? response.lista : []

    if (page === 1) console.debug('[Imoview] página 1 resposta →', { quantidade: response?.quantidade, listaLength: lista.length, primeiroItem: lista[0] ?? null })

    allItems.push(...lista)
    hasMore = lista.length >= PAGE_SIZE
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
        valor: parseCurrency(item.saldo),
        data_vencimento: datavenc,
        data_pagamento: datapagto,
        dados_json: item,
      }]
    }

    return detalhes.map((detalhe) => ({
      codigo: String(detalhe.codigodetalhe ?? item.codigo ?? ''),
      historico: sanitizeText(detalhe.descricao ?? item.historico ?? ''),
      valor: parseCurrency(detalhe.valor),
      data_vencimento: datavenc,
      data_pagamento: datapagto,
      dados_json: detalhe,
    }))
  })

  const movimentos = dedupeMovimentos(movimentosRaw)

  const subtotal = movimentos.reduce((acc, m) => acc + m.valor, 0)

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
