import { supabase } from '../lib/supabaseClient'
import { fetchMovimentosImoview, normalizeMovimentosPayload, pesquisarClientePorCpf } from './imoviewService'

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

function serializeMovimentos(movimentos) {
  if (!Array.isArray(movimentos) || !movimentos.length) {
    return []
  }

  return movimentos.map((movimento, index) => ({
    codigo: String(movimento.codigo ?? index + 1),
    historico: String(movimento.historico ?? '').trim(),
    valor: normalizeNumber(movimento.valor),
    data_vencimento: parseDateBrToIso(movimento.data_vencimento),
    data_pagamento: parseDateBrToIso(movimento.data_pagamento),
    dados_json: movimento.dados_json ?? movimento,
  }))
}

export async function listAnalisesBoletos(userId) {
  const { data, error } = await supabase
    .from('analises_boletos')
    .select(
      'id, nome, mes_foco, ano_foco, mes_comparacao, ano_comparacao, created_at, contratos_analise(count)',
    )
    .eq('user_id', userId)
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

export async function updateAnaliseBoleto({ analiseId, userId, nome, mesFoco, anoFoco, mesComparacao, anoComparacao }) {
  const { data, error } = await supabase
    .from('analises_boletos')
    .update({ nome, mes_foco: mesFoco, ano_foco: anoFoco, mes_comparacao: mesComparacao, ano_comparacao: anoComparacao })
    .eq('id', analiseId)
    .eq('user_id', userId)
    .select('*')
    .single()

  if (error) {
    throw error
  }

  return data
}

export async function deleteAnaliseBoleto({ analiseId, userId }) {
  const { error } = await supabase
    .from('analises_boletos')
    .delete()
    .eq('id', analiseId)
    .eq('user_id', userId)

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

export async function getAnaliseBoletoById({ analiseId, userId }) {
  const { data, error } = await supabase
    .from('analises_boletos')
    .select('*')
    .eq('id', analiseId)
    .eq('user_id', userId)
    .single()

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

  // Resolve o codigo_cliente real via CPF antes de buscar extratos.
  // Na planilha, a coluna "Codigo" é o codigo do contrato, nao do cliente.
  let resolvedCodigoCliente = contrato.codigo_cliente
  const cpf = contrato.cpf_locatario?.trim()

  if (cpf) {
    try {
      const clienteInfo = await pesquisarClientePorCpf(cpf)
      if (clienteInfo?.codigoCliente) {
        resolvedCodigoCliente = clienteInfo.codigoCliente
      }
    } catch {
      // Se falhar, tenta usar o codigo_cliente original como fallback.
    }
  }

  const errors = []

  for (let iterationIndex = 0; iterationIndex < periodos.length; iterationIndex += 1) {
    const periodo = periodos[iterationIndex]

    try {
      const response = await fetchMovimentosImoview({
        codigoCliente: resolvedCodigoCliente,
        codigoContrato: contrato.codigo_contrato,
        codigoImovel: contrato.codigo_imovel,
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

  for (let index = 0; index < contratos.length; index += 1) {
    const contrato = contratos[index]

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

    if (result.failedIterations > 0) {
      errors.push({
        codigoContrato: contrato.codigo_contrato,
        codigoCliente: contrato.codigo_cliente,
        message: `Falha em ${result.failedIterations} periodo(s) do contrato.`,
        details: result.errors,
      })
    }
  }

  return {
    total: totalIterations,
    failed: errors.length,
    errors,
  }
}

export async function loadComparativoAnalise(analiseId) {
  const { data: contratos, error: contratosError } = await supabase
    .from('contratos_analise')
    .select('*')
    .eq('analise_id', analiseId)

  if (contratosError) {
    throw contratosError
  }

  const { data: extratos, error: extratosError } = await supabase
    .from('extratos_boletos')
    .select(
      'id, analise_id, codigo_cliente, codigo_contrato, mes, ano, subtotal, dados_json, created_at, movimentos_boletos(*)',
    )
    .eq('analise_id', analiseId)

  if (extratosError) {
    throw extratosError
  }

  return {
    contratos: contratos ?? [],
    extratos: extratos ?? [],
  }
}
