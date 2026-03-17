import { sanitizeText } from './textSanitizer'

function normalizeHeader(value) {
  return sanitizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function codeToString(value) {
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

function findColumnKey(headers, aliases) {
  const normalizedAliases = aliases.map((alias) => normalizeHeader(alias))

  return headers.find((header) => {
    const normalizedHeader = normalizeHeader(header)
    return normalizedAliases.some((alias) => normalizedHeader.includes(alias))
  })
}

function findExactColumnKey(headers, exactHeader) {
  const normalizedTarget = normalizeHeader(exactHeader)
  return headers.find((header) => normalizeHeader(header) === normalizedTarget)
}

function dedupeContracts(contracts) {
  const uniqueMap = new Map()

  contracts.forEach((contract) => {
    const key = `${contract.codigoCliente}|${contract.codigoContrato}|${contract.codigoImovel}`
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, contract)
    }
  })

  return Array.from(uniqueMap.values())
}

function parseDateString(value) {
  const text = sanitizeText(value)

  if (!text) {
    return null
  }

  const fullDate = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+\d{1,2}:\d{2})?$/)
  if (fullDate) {
    const day = Number(fullDate[1])
    const month = Number(fullDate[2])
    let year = Number(fullDate[3])

    if (year < 100) {
      year += 2000
    }

    const date = new Date(year, month - 1, day)
    return Number.isNaN(date.getTime()) ? null : date
  }

  const asDate = new Date(text)
  return Number.isNaN(asDate.getTime()) ? null : asDate
}

function getRescisaoWindow({ dataInicioFoco, dataFimFoco }) {
  if (!dataInicioFoco || !dataFimFoco) {
    return null
  }

  const startDate = new Date(dataInicioFoco + 'T00:00:00')
  const endDate = new Date(dataFimFoco + 'T00:00:00')

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return null
  }

  // Margem de 1 mes antes do inicio e 1 mes depois do fim do periodo foco.
  const start = new Date(startDate.getFullYear(), startDate.getMonth() - 1, 1)
  const end = new Date(endDate.getFullYear(), endDate.getMonth() + 2, 0, 23, 59, 59, 999)

  return { start, end }
}

function extractLocadorFromImoveis(value) {
  const text = sanitizeText(value)
  if (!text) {
    return ''
  }

  const match = text.match(/\(Locador\s+([^|)]+)\|/i)
  return sanitizeText(match?.[1] ?? '')
}

function shouldIncludeBySituacao({ situacao, dataRescisao, rescisaoWindow }) {
  const normalizedSituacao = normalizeHeader(situacao)

  if (normalizedSituacao === 'ativo') {
    return true
  }

  if (normalizedSituacao === 'rescindido') {
    if (!rescisaoWindow) {
      return true
    }

    const rescisaoDate = parseDateString(dataRescisao)
    if (!rescisaoDate) {
      return false
    }

    return rescisaoDate >= rescisaoWindow.start && rescisaoDate <= rescisaoWindow.end
  }

  return false
}

export async function parseContractsFromSpreadsheet(file, options = {}) {
  const XLSX = await import('xlsx')
  const arrayBuffer = await file.arrayBuffer()
  const workbook = XLSX.read(arrayBuffer, { type: 'array' })
  const firstSheetName = workbook.SheetNames[0]

  if (!firstSheetName) {
    throw new Error('A planilha enviada nao possui abas validas.')
  }

  const worksheet = workbook.Sheets[firstSheetName]
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    defval: '',
    raw: false,
  })

  if (!rows.length) {
    return {
      contracts: [],
      skippedRows: 0,
      skippedByStatusRule: 0,
      detectedColumns: {},
    }
  }

  const headers = Object.keys(rows[0])

  const codigoContratoKey =
    findExactColumnKey(headers, 'Codigo') ||
    findColumnKey(headers, ['codigo contrato', 'cod contrato', 'contrato codigo', 'contrato'])

  const codigoClienteDetectedKey = findColumnKey(headers, [
    'codigo cliente',
    'locatario codigo',
    'codigocliente',
    'cod cliente',
    'cliente codigo',
    'cliente',
  ])
  const codigoClienteKey = codigoClienteDetectedKey || codigoContratoKey
  const codigoImovelKey = findColumnKey(headers, [
    'codigo imovel',
    'cod imovel',
    'imovel codigo',
    'imovel',
  ])
  const locatarioKey = findColumnKey(headers, ['locatario', 'inquilino'])
  const locadorKey = findColumnKey(headers, ['locador', 'proprietario'])
  const situacaoKey = findColumnKey(headers, ['situacao', 'status contrato'])
  const dataRescisaoKey = findColumnKey(headers, ['data rescisao'])
  const imoveisKey = findColumnKey(headers, ['imoveis'])
  const cpfLocatarioKey = findColumnKey(headers, ['locatariocpf', 'locatario cpf', 'cpf locatario', 'cpf'])

  if (!codigoContratoKey) {
    throw new Error('Nao foi possivel identificar a coluna de codigo do contrato (Codigo) na planilha.')
  }

  if (!codigoClienteKey) {
    throw new Error('Nao foi possivel identificar codigo de cliente/contrato na planilha.')
  }

  const contracts = []
  let skippedRows = 0
  let skippedByStatusRule = 0
  const rescisaoWindow = getRescisaoWindow(options)

  rows.forEach((row) => {
    const codigoCliente = codeToString(row[codigoClienteKey])
    const codigoContrato = codeToString(codigoContratoKey ? row[codigoContratoKey] : '')
    const codigoImovel = codeToString(codigoImovelKey ? row[codigoImovelKey] : '')

    if (!codigoCliente) {
      skippedRows += 1
      return
    }

    if (
      situacaoKey &&
      !shouldIncludeBySituacao({
        situacao: row[situacaoKey],
        dataRescisao: dataRescisaoKey ? row[dataRescisaoKey] : '',
        rescisaoWindow,
      })
    ) {
      skippedByStatusRule += 1
      return
    }

    const locatarioValue = sanitizeText(locatarioKey ? row[locatarioKey] ?? '' : '')
    const locadorFromColumn = sanitizeText(locadorKey ? row[locadorKey] ?? '' : '')
    const locadorFromImovel = extractLocadorFromImoveis(imoveisKey ? row[imoveisKey] : '')
    const cpfLocatario = sanitizeText(cpfLocatarioKey ? row[cpfLocatarioKey] ?? '' : '')

    contracts.push({
      codigoCliente,
      codigoContrato,
      codigoImovel,
      locatario: locatarioValue,
      locador: locadorFromColumn || locadorFromImovel,
      cpfLocatario,
    })
  })

  return {
    contracts: dedupeContracts(contracts),
    skippedRows,
    skippedByStatusRule,
    detectedColumns: {
      codigoCliente: codigoClienteKey ?? null,
      codigoContrato: codigoContratoKey ?? null,
      codigoImovel: codigoImovelKey ?? null,
      locatario: locatarioKey ?? null,
      locador: locadorKey ?? null,
      situacao: situacaoKey ?? null,
      dataRescisao: dataRescisaoKey ?? null,
      cpfLocatario: cpfLocatarioKey ?? null,
    },
  }
}
