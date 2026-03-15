import { supabase } from '../lib/supabaseClient'
import { fetchMovimentosImoview, normalizeMovimentosPayload } from './imoviewService'

function normalizeNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseDateBrToIso(value) {
  if (!value) {
    return null
  }

  const source = String(value)
  const match = source.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!match) {
    return source.slice(0, 10)
  }

  return `${match[3]}-${match[2]}-${match[1]}`
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
  const valor = normalizeNumber(movimento?.valor).toFixed(2)
  const vencimento = parseDateBrToIso(movimento?.data_vencimento)
  const pagamento = parseDateBrToIso(movimento?.data_pagamento)

  return `${codigo}|${planoConta}|${historico}|${valor}|${vencimento}|${pagamento}`
}

function serializeMovimentos(movimentos) {
  if (!Array.isArray(movimentos) || !movimentos.length) {
    return []
  }

  const seen = new Set()
  const serialized = []

  for (let index = 0; index < movimentos.length; index += 1) {
    const movimento = movimentos[index]
    const key = buildMovimentoFingerprint(movimento)

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    serialized.push({
      codigo: String(movimento.codigo ?? index + 1),
      historico: String(movimento.historico ?? '').trim(),
      valor: normalizeNumber(movimento.valor),
      data_vencimento: parseDateBrToIso(movimento.data_vencimento),
      data_pagamento: parseDateBrToIso(movimento.data_pagamento),
      dados_json: movimento.dados_json ?? movimento,
    })
  }

  return serialized
}

function resolveRemessaConcurrency() {
  const parsedNormal = Number.parseInt(import.meta.env.VITE_REMESSA_CONCURRENCY ?? '', 10)
  if (Number.isFinite(parsedNormal) && parsedNormal > 0) {
    return Math.min(parsedNormal, 12)
  }

  const parsedQuick = Number.parseInt(import.meta.env.VITE_REMESSA_RAPIDA_CONCURRENCY ?? '', 10)
  if (Number.isFinite(parsedQuick) && parsedQuick > 0) {
    return Math.min(parsedQuick, 12)
  }

  return 4
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function getErrorStatus(error) {
  const status = Number(error?.status)
  return Number.isFinite(status) ? status : 0
}

function isTransientError(error) {
  const status = getErrorStatus(error)
  if (status >= 500) {
    return true
  }

  const message = String(error?.message ?? '').toLowerCase()
  if (
    message.includes('statement timeout') ||
    message.includes('canceling statement due to statement timeout') ||
    message.includes('fetch failed') ||
    message.includes('networkerror') ||
    message.includes('failed to fetch') ||
    message.includes('cors')
  ) {
    return true
  }

  return false
}

async function withRetry(operation, {
  retries = 2,
  baseDelayMs = 350,
  maxDelayMs = 1800,
  shouldRetry = isTransientError,
} = {}) {
  let attempt = 0
  let lastError = null

  while (attempt <= retries) {
    try {
      return await operation()
    } catch (error) {
      lastError = error

      if (attempt >= retries || !shouldRetry(error)) {
        throw error
      }

      const delayMs = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)
      await sleep(delayMs)
      attempt += 1
    }
  }

  throw lastError
}

function chunkArray(items, chunkSize) {
  if (!Array.isArray(items) || !items.length) {
    return []
  }

  const chunks = []
  const size = Math.max(1, chunkSize)

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}

async function runWithConcurrency(items, concurrency, worker) {
  if (!Array.isArray(items) || !items.length) {
    return []
  }

  const results = new Array(items.length)
  let nextIndex = 0

  async function runWorker() {
    while (true) {
      const currentIndex = nextIndex
      nextIndex += 1

      if (currentIndex >= items.length) {
        return
      }

      results[currentIndex] = await worker(items[currentIndex], currentIndex)
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length))
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()))

  return results
}

export async function listAnalisesBoletos() {
  const { data, error } = await supabase
    .from('analises_boletos')
    .select(
      'id, nome, mes_foco, ano_foco, mes_comparacao, ano_comparacao, created_at, contratos_analise(count)',
    )
    .order('created_at', { ascending: false })

  if (error) {
    throw error
  }

  return (data ?? []).map((item) => ({
    ...item,
    quantidade_contratos: item?.contratos_analise?.[0]?.count ?? 0,
  }))
}

export async function createAnaliseBoleto({
  nome,
  mesFoco,
  anoFoco,
  mesComparacao,
  anoComparacao,
  userId,
}) {
  const { data, error } = await supabase
    .from('analises_boletos')
    .insert({
      nome,
      mes_foco: mesFoco,
      ano_foco: anoFoco,
      mes_comparacao: mesComparacao,
      ano_comparacao: anoComparacao,
      user_id: userId,
    })
    .select('*')
    .single()

  if (error) {
    throw error
  }

  return data
}

export async function updateAnaliseBoleto({ analiseId, nome, mesFoco, anoFoco, mesComparacao, anoComparacao }) {
  const { data, error } = await supabase
    .from('analises_boletos')
    .update({ nome, mes_foco: mesFoco, ano_foco: anoFoco, mes_comparacao: mesComparacao, ano_comparacao: anoComparacao })
    .eq('id', analiseId)
    .select('*')
    .single()

  if (error) {
    throw error
  }

  return data
}

export async function deleteAnaliseBoleto({ analiseId }) {
  const { error } = await supabase
    .from('analises_boletos')
    .delete()
    .eq('id', analiseId)

  if (error) {
    throw error
  }
}

export async function updateContratoStatusObservacao({ contratoId, status, observacao }) {
  const { error } = await supabase
    .from('contratos_analise')
    .update({ status, observacao })
    .eq('id', contratoId)

  if (error) {
    throw error
  }
}

export async function updateContratoAnaliseIA({ contratoId, analiseIa }) {
  const { error } = await supabase
    .from('contratos_analise')
    .update({ analise_ia: String(analiseIa ?? '') })
    .eq('id', contratoId)

  if (error) {
    throw error
  }
}

export async function updateContratosSortOrder(updates) {
  // updates: Array<{ id: number, sort_order: number }>
  await Promise.all(
    updates.map(({ id, sort_order }) =>
      supabase.from('contratos_analise').update({ sort_order }).eq('id', id),
    ),
  )
}

export async function updateContratoSituacao({ contratoId, situacao }) {
  const { error } = await supabase
    .from('contratos_analise')
    .update({ situacao })
    .eq('id', contratoId)

  if (error) {
    throw error
  }
}

export async function resetContratosSituacao(analiseId) {
  const { error } = await supabase
    .from('contratos_analise')
    .update({ situacao: 'desatualizado' })
    .eq('analise_id', analiseId)

  if (error) {
    throw error
  }
}

export async function getAnaliseBoletoById({ analiseId }) {
  const { data, error } = await withRetry(async () => {
    const response = await supabase
      .from('analises_boletos')
      .select('*')
      .eq('id', analiseId)
      .single()

    if (response.error) {
      throw response.error
    }

    return response
  })

  if (error) {
    throw error
  }

  return data
}

export async function upsertContratosAnalise(analiseId, contracts) {
  if (!contracts.length) {
    return []
  }

  const payload = contracts.map((item) => ({
    analise_id: analiseId,
    codigo_cliente: String(item.codigoCliente ?? '').trim(),
    codigo_contrato: String(item.codigoContrato ?? '').trim(),
    codigo_imovel: String(item.codigoImovel ?? '').trim(),
    locatario: String(item.locatario ?? '').trim(),
    locador: String(item.locador ?? '').trim(),
    cpf_locatario: String(item.cpfLocatario ?? '').trim(),
  }))

  const { data, error } = await supabase
    .from('contratos_analise')
    .upsert(payload, {
      onConflict: 'analise_id,codigo_cliente,codigo_contrato,codigo_imovel',
    })
    .select('*')

  if (error) {
    throw error
  }

  return data ?? []
}

export async function listContratosByAnalise(analiseId) {
  const { data, error } = await supabase
    .from('contratos_analise')
    .select('*')
    .eq('analise_id', analiseId)
    .order('codigo_contrato', { ascending: true })

  if (error) {
    throw error
  }

  return data ?? []
}

async function updateContratoMetadata({ contrato, normalizedExtrato }) {
  const nextCodigoContrato =
    !contrato.codigo_contrato && normalizedExtrato.codigoContrato
      ? String(normalizedExtrato.codigoContrato).trim()
      : ''
  const nextCodigoImovel =
    !contrato.codigo_imovel && normalizedExtrato.codigoImovel
      ? String(normalizedExtrato.codigoImovel).trim()
      : ''
  const nextLocatario =
    !contrato.locatario && normalizedExtrato.locatario
      ? String(normalizedExtrato.locatario).trim()
      : ''
  const nextLocador =
    !contrato.locador && normalizedExtrato.locador ? String(normalizedExtrato.locador).trim() : ''

  if (!nextCodigoContrato && !nextCodigoImovel && !nextLocatario && !nextLocador) {
    return
  }

  const payload = {
    codigo_contrato: nextCodigoContrato || contrato.codigo_contrato,
    codigo_imovel: nextCodigoImovel || contrato.codigo_imovel,
    locatario: nextLocatario || contrato.locatario,
    locador: nextLocador || contrato.locador,
  }

  const { error } = await supabase
    .from('contratos_analise')
    .update(payload)
    .eq('id', contrato.id)

  if (error) {
    throw error
  }

  contrato.codigo_contrato = payload.codigo_contrato
  contrato.codigo_imovel = payload.codigo_imovel
  contrato.locatario = payload.locatario
  contrato.locador = payload.locador
}

export async function upsertExtratoComMovimentos({
  analiseId,
  contrato,
  mes,
  ano,
  normalizedExtrato,
}) {
  const resolvedCodigoContrato =
    String(normalizedExtrato.codigoContrato ?? '').trim() || String(contrato.codigo_contrato ?? '').trim()

  // Limpa extratos antigos do mesmo cliente/periodo com codigo_contrato divergente.
  // Isso evita linhas "fantasma" sem movimentos criadas antes do fallback da API.
  {
    const originalCtr = String(contrato.codigo_contrato ?? '').trim()
    const codesParaDeletar = new Set()

    if (!originalCtr && resolvedCodigoContrato) {
      codesParaDeletar.add('')
    }

    if (originalCtr && resolvedCodigoContrato && originalCtr !== resolvedCodigoContrato) {
      codesParaDeletar.add(originalCtr)
    }

    for (const ctr of codesParaDeletar) {
      const { error: cleanupError } = await supabase
        .from('extratos_boletos')
        .delete()
        .eq('analise_id', analiseId)
        .eq('codigo_cliente', contrato.codigo_cliente)
        .eq('codigo_contrato', ctr)
        .eq('mes', mes)
        .eq('ano', ano)

      if (cleanupError) {
        throw cleanupError
      }
    }
  }

  const upsertPayload = {
    analise_id: analiseId,
    codigo_cliente: contrato.codigo_cliente,
    codigo_contrato: resolvedCodigoContrato,
    mes,
    ano,
    subtotal: normalizeNumber(normalizedExtrato.subtotal),
    dados_json: normalizedExtrato.dadosJson,
  }

  const { data: extratoRow, error: extratoError } = await supabase
    .from('extratos_boletos')
    .upsert(upsertPayload, { onConflict: 'analise_id,codigo_cliente,codigo_contrato,mes,ano' })
    .select('*')
    .single()

  if (extratoError) {
    throw extratoError
  }

  const { error: deleteError } = await supabase
    .from('movimentos_boletos')
    .delete()
    .eq('extrato_id', extratoRow.id)

  if (deleteError) {
    throw deleteError
  }

  const movimentos = serializeMovimentos(normalizedExtrato.movimentos)

  if (movimentos.length) {
    const payload = movimentos.map((movimento) => ({
      ...movimento,
      extrato_id: extratoRow.id,
    }))

    const { error: movimentosError } = await supabase.from('movimentos_boletos').insert(payload)

    if (movimentosError) {
      throw movimentosError
    }
  }

  await updateContratoMetadata({
    contrato,
    normalizedExtrato,
  })

  return extratoRow
}

export async function coletarExtratosParaContrato({
  analise,
  contrato,
  onIteration,
  continueOnError = false,
}) {
  const periodos = [
    { mes: analise.mes_foco, ano: analise.ano_foco },
    { mes: analise.mes_comparacao, ano: analise.ano_comparacao },
  ]

  const errors = []

  for (let iterationIndex = 0; iterationIndex < periodos.length; iterationIndex += 1) {
    const periodo = periodos[iterationIndex]

    try {
      const response = await fetchMovimentosImoview({
        codigoContrato: contrato.codigo_contrato,
        ano: periodo.ano,
        mes: periodo.mes,
      })

      const normalizedExtrato = normalizeMovimentosPayload(response, {
        codigoContrato: contrato.codigo_contrato,
        codigoImovel: contrato.codigo_imovel,
        mes: periodo.mes,
        ano: periodo.ano,
      })

      await upsertExtratoComMovimentos({
        analiseId: analise.id,
        contrato,
        mes: periodo.mes,
        ano: periodo.ano,
        normalizedExtrato,
      })

      onIteration?.({
        contrato,
        periodo,
        iterationIndex: iterationIndex + 1,
        totalIterations: periodos.length,
        success: true,
        errorMessage: '',
      })
    } catch (error) {
      errors.push({
        contrato,
        periodo,
        message: error.message,
      })

      onIteration?.({
        contrato,
        periodo,
        iterationIndex: iterationIndex + 1,
        totalIterations: periodos.length,
        success: false,
        errorMessage: error.message,
      })

      if (!continueOnError) {
        throw error
      }
    }
  }

  return {
    totalIterations: periodos.length,
    failedIterations: errors.length,
    errors,
  }
}

export async function coletarExtratosParaAnalise({ analise, contratos, onProgress }) {
  const errors = []
  const totalIterations = contratos.length * 2
  let processedIterations = 0
  const concurrency = resolveRemessaConcurrency()

  const resultsByContrato = await runWithConcurrency(contratos, concurrency, async (contrato) => {
    const result = await coletarExtratosParaContrato({
      analise,
      contrato,
      continueOnError: true,
      onIteration: ({ periodo, success, errorMessage }) => {
        processedIterations += 1

        onProgress?.({
          processed: processedIterations,
          total: totalIterations,
          contrato,
          periodo,
          success,
          errorMessage,
        })
      },
    })

    return {
      contrato,
      result,
    }
  })

  for (let index = 0; index < resultsByContrato.length; index += 1) {
    const { contrato, result } = resultsByContrato[index]

    if (result.failedIterations <= 0) {
      continue
    }

    errors.push({
      codigoContrato: contrato.codigo_contrato,
      codigoCliente: contrato.codigo_cliente,
      message: `Falha em ${result.failedIterations} periodo(s) do contrato.`,
      details: result.errors,
    })
  }

  return {
    total: totalIterations,
    failed: errors.length,
    errors,
  }
}

export async function loadComparativoAnalise(analiseId) {
  const { data: contratos } = await withRetry(async () => {
    const response = await supabase
      .from('contratos_analise')
      .select('*')
      .eq('analise_id', analiseId)

    if (response.error) {
      throw response.error
    }

    return response
  })

  const { data: extratosBase } = await withRetry(async () => {
    const response = await supabase
      .from('extratos_boletos')
      .select('id, analise_id, codigo_cliente, codigo_contrato, mes, ano, subtotal, dados_json, created_at')
      .eq('analise_id', analiseId)

    if (response.error) {
      throw response.error
    }

    return response
  })

  const extratos = extratosBase ?? []
  if (!extratos.length) {
    return {
      contratos: contratos ?? [],
      extratos: [],
    }
  }

  const extratoIds = extratos.map((row) => row.id)
  const movimentosChunks = chunkArray(extratoIds, 200)
  const movimentosByExtratoId = new Map()

  for (let index = 0; index < movimentosChunks.length; index += 1) {
    const idsChunk = movimentosChunks[index]

    const { data: movimentosChunk } = await withRetry(async () => {
      const response = await supabase
        .from('movimentos_boletos')
        .select('id, extrato_id, codigo, historico, valor, data_vencimento, data_pagamento, dados_json, created_at')
        .in('extrato_id', idsChunk)

      if (response.error) {
        throw response.error
      }

      return response
    })

    for (let movimentoIndex = 0; movimentoIndex < (movimentosChunk ?? []).length; movimentoIndex += 1) {
      const movimento = movimentosChunk[movimentoIndex]
      const extratoId = movimento.extrato_id

      if (!movimentosByExtratoId.has(extratoId)) {
        movimentosByExtratoId.set(extratoId, [])
      }

      movimentosByExtratoId.get(extratoId).push(movimento)
    }
  }

  const extratosWithMovimentos = extratos.map((extrato) => ({
    ...extrato,
    movimentos_boletos: movimentosByExtratoId.get(extrato.id) ?? [],
  }))

  return {
    contratos: contratos ?? [],
    extratos: extratosWithMovimentos,
  }
}
