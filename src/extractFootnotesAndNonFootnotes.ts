export const extractFootnotesAndNonFootnotes = (latexDoc: string) => {
  let nonFootnote = ''
  let footnotes = []
  let captions = []
  let buffer = ''
  let inFootnote = false
  let inCaption = false
  let braceLevel = 0

  for (let i = 0; i < latexDoc.length; i++) {
    const char = latexDoc[i]

    if (char === '\\' && latexDoc.slice(i, i + 9) === '\\footnote') {
      if (inFootnote) {
        footnotes.push(buffer)
      }
      if (!inFootnote) {
        nonFootnote += buffer
      }
      buffer = ''
      inFootnote = true
      i += 8 // Skip '\\footnote'
      continue
    }

    if (char === '\\' && latexDoc.slice(i, i + 8) === '\\caption') {
      if (inCaption) {
        captions.push(buffer)
      }
      if (!inCaption) {
        nonFootnote += buffer
      }
      buffer = ''
      inCaption = true
      i += 7 // Skip '\\footnote'
      continue
    }

    if (char === '{' && (inFootnote || inCaption)) {
      braceLevel++
      buffer += char
      continue
    }

    if (char === '}' && (inFootnote || inCaption)) {
      braceLevel--
      if (braceLevel === 0) {
        ;(inFootnote ? footnotes : captions).push(buffer)
        buffer = ''
        if (inFootnote) {
          inFootnote = false
        } else {
          inCaption = false
        }
      }
      if (braceLevel !== 0) {
        buffer += char
      }
      continue
    }

    buffer += char
  }

  if (inFootnote) {
    footnotes.push(buffer)
  }
  if (!inFootnote) {
    nonFootnote += buffer
  }

  return { nonFootnote, footnotes, captions }
}
