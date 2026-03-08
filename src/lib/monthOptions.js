export const MONTH_OPTIONS = [
  { value: 1, label: 'Janeiro' },
  { value: 2, label: 'Fevereiro' },
  { value: 3, label: 'Marco' },
  { value: 4, label: 'Abril' },
  { value: 5, label: 'Maio' },
  { value: 6, label: 'Junho' },
  { value: 7, label: 'Julho' },
  { value: 8, label: 'Agosto' },
  { value: 9, label: 'Setembro' },
  { value: 10, label: 'Outubro' },
  { value: 11, label: 'Novembro' },
  { value: 12, label: 'Dezembro' },
]

export function getMonthLabel(monthNumber) {
  return MONTH_OPTIONS.find((month) => month.value === Number(monthNumber))?.label ?? '-'
}

export function getCurrentMonthYear() {
  const now = new Date()
  return {
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  }
}

export function getPreviousMonthYear() {
  const now = new Date()
  const date = new Date(now.getFullYear(), now.getMonth() - 1, 1)

  return {
    month: date.getMonth() + 1,
    year: date.getFullYear(),
  }
}
