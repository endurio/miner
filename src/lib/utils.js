/* global BigInt */

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

module.exports = {
  summary,
  extractErrorMessage,
}
