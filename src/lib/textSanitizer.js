const htmlEntityMap = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

export function decodeHtmlEntities(value) {
  const input = String(value ?? '')

  if (!input) {
    return ''
  }

  // Browser path: leverages native HTML parser for complete entity decoding.
  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea')
    textarea.innerHTML = input
    return textarea.value
  }

  // Fallback for non-browser contexts.
  return input
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([\da-fA-F]+);/g, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&([a-zA-Z]+);/g, (_, name) => htmlEntityMap[name] ?? `&${name};`)
}

export function sanitizeText(value) {
  return decodeHtmlEntities(value)
    .replace(/\s+/g, ' ')
    .trim()
}
