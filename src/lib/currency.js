export function formatCurrency(value) {
  if (value === null || value === undefined || value === '') {
    return Number(0).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    })
  }

  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? value.toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        })
      : Number(0).toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        })
  }

  let source = String(value).trim().replace(/[^\d,.-]/g, '')
  if (!source) {
    return Number(0).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    })
  }

  const hasComma = source.includes(',')
  const hasDot = source.includes('.')
  if (hasComma && hasDot) {
    source = source.lastIndexOf(',') > source.lastIndexOf('.')
      ? source.replace(/\./g, '').replace(',', '.')
      : source.replace(/,/g, '')
  } else if (hasComma) {
    source = source.replace(/\./g, '').replace(',', '.')
  } else {
    source = source.replace(/,/g, '')
  }

  const parsed = Number(source)

  return (Number.isFinite(parsed) ? parsed : 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}
