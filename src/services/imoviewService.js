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

function getMonthDateRange(mes, ano) {
  const mm = String(mes).padStart(2, '0')
  const lastDay = new Date(ano, mes, 0).getDate()
  const ddLast = String(lastDay).padStart(2, '0')

  return {
    dataInicial: `01/${mm}/${ano}`,
    dataFinal: `${ddLast}/${mm}/${ano}`,
  }
}

export async function fetchMovimentosImoview({ codigoCliente, codigoContrato, codigoImovel, ano, mes }) {
  const apiKey = import.meta.env.VITE_IMOVIEW_API_KEY

  if (!apiKey) {
    throw new Error('Defina VITE_IMOVIEW_API_KEY no arquivo .env para consultar a API do Imoview.')
  }

  const { dataInicial, dataFinal } = getMonthDateRange(mes, ano)
  const headers = { chave: apiKey }
  const PAGE_SIZE = 1000

  const baseParams = {
    numeroRegistros: String(PAGE_SIZE),
    codigoCliente: String(codigoCliente),
    dataVencimentoInicial: dataInicial,
    dataVencimentoFinal: dataFinal,
  }

  if (codigoContrato) {
    baseParams.codigoContratoAluguel = String(codigoContrato)
  }

  if (codigoImovel) {
    baseParams.codigoImovel = String(codigoImovel)
  }

  const allItems = []
  let page = 1
  let hasMore = true

  while (hasMore) {
    const response = await requestImoview(
      '/Movimento/RetornarMovimentos',
      { ...baseParams, numeroPagina: String(page) },
      headers,
    )
    const lista = Array.isArray(response?.lista) ? response.lista : []
    allItems.push(...lista)
    hasMore = lista.length >= PAGE_SIZE
    page += 1
  }

  return { quantidade: allItems.length, lista: allItems }
}

export function normalizeMovimentosPayload(response, context = {}) {
  const lista = Array.isArray(response?.lista) ? response.lista : []

  const first = lista[0]
  const codigoContrato =
    normalizeCode(first?.codigocontratoaluguel) || String(context.codigoContrato ?? '')
  const codigoImovel = normalizeCode(first?.codigoimovel) || String(context.codigoImovel ?? '')
  const locatario = sanitizeText(first?.nomecliente ?? '')

  // Intervalo esperado para filtro client-side (garante que só entram movimentos do mês pedido)
  const mesContext = context.mes ? Number(context.mes) : null
  const anoContext = context.ano ? Number(context.ano) : null
  const rangeStart = mesContext && anoContext
    ? new Date(anoContext, mesContext - 1, 1)
    : null
  const rangeEnd = mesContext && anoContext
    ? new Date(anoContext, mesContext, 0, 23, 59, 59)
    : null

  function isWithinRange(isoDate) {
    if (!rangeStart || !rangeEnd || !isoDate) {
      return true
    }
    const d = new Date(isoDate)
    return d >= rangeStart && d <= rangeEnd
  }

  const movimentos = lista.flatMap((item) => {
    const datavenc = toIsoDate(item.datavencimento)
    const datapagto = toIsoDate(item.datapagamento)
    const detalhes = Array.isArray(item.detalhes) ? item.detalhes : []

    // Descarta o movimento inteiro se o vencimento estiver fora do período pedido
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

  const payload = await requestImoview(
    '/Cliente/App_PesquisarCliente',
    { codigoUsuario, textoPesquisa: cpf },
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
