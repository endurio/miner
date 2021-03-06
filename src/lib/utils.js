/* global BigInt */

function strip0x(s) {
  return s.startsWith('0x') ? s.substring(2) : s
}

function summary(address, firstSegLength = 6, lastSegLength = 6, includeHex = true) {
  try {
    if (!address) return ''
    const hasHex = address.startsWith('0x')
    if (hasHex) {
      address = address.substring(2)
    }
    address = address.slice(0, firstSegLength) + '...' + address.slice(-lastSegLength)
    if (hasHex && includeHex) {
      address = '0x' + address
    }
    return address
  } catch (err) {
    console.error(err)
    return address
  }
}

function extractErrorMessage(error) {
  for (let i = 0; i < 10 && !!error.error; ++i) {
    error = error.error
  }
  return error.message || error
}

function extractReason(error) {
  error = extractErrorMessage(error)
  const matches = error.match(/reason="(.*)"/)
  if (matches && matches.length > 1) {
    return matches[1]
  }
  return error
}

module.exports = {
  strip0x,
  summary,
  extractErrorMessage,
  extractReason,
}
