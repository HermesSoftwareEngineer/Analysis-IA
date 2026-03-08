import { formatCurrency } from '../lib/currency'

function formatDate(dateValue) {
  if (!dateValue) {
    return '-'
  }

  const date = new Date(dateValue)
  if (Number.isNaN(date.getTime())) {
    return String(dateValue)
  }

  return date.toLocaleDateString('pt-BR')
}



function ExtratoMovimentosTable({ title, subtitle, subtotal, externalUrl, movimentos }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
          <p className="mt-1 text-sm font-semibold text-slate-800">Subtotal: {formatCurrency(subtotal)}</p>
          {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
        </div>

        {externalUrl ? (
          <a
            href={externalUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-cyan-300 bg-cyan-50 px-3 py-1.5 text-xs font-semibold text-cyan-800 transition hover:border-cyan-400 hover:bg-cyan-100"
          >
            Abrir extrato externo
          </a>
        ) : null}
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-xs">
          <thead className="bg-slate-50 text-left uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-2 py-2 font-semibold">Plano de conta</th>
              <th className="px-2 py-2 font-semibold">Descricao</th>
              <th className="px-2 py-2 font-semibold">Vencimento</th>
              <th className="px-2 py-2 font-semibold">Pagamento</th>
              <th className="px-2 py-2 font-semibold">Valor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {!movimentos.length ? (
              <tr>
                <td colSpan={5} className="px-2 py-4 text-center text-slate-500">
                  Sem movimentos encontrados.
                </td>
              </tr>
            ) : null}

            {movimentos.map((movimento, index) => (
              <tr key={movimento.id ?? index} className="align-top">
                <td className="px-2 py-2 text-slate-600">{movimento.dados_json?.nomeplanoconta || '-'}</td>
                <td className="px-2 py-2 font-medium text-slate-800">{movimento.historico || '-'}</td>
                <td className="px-2 py-2">{formatDate(movimento.data_vencimento)}</td>
                <td className="px-2 py-2">{formatDate(movimento.data_pagamento)}</td>
                <td className="px-2 py-2 font-semibold">{formatCurrency(movimento.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default ExtratoMovimentosTable
