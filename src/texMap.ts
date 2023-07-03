export type CitationObject = {
  prefix?: string
  suffix?: string
  key: string
  type: 'paren' | 'text' | 'author' | 'year'
  position: 'alone' | 'first' | 'middle' | 'last'
}

export function findCitations(document: string): CitationObject[]
export function findCitations(
  document: string,
  callback: (citation: CitationObject) => string
): string
export function findCitations(
  document: string,
  callback?: (citation: CitationObject) => string
): string | CitationObject[] {
  const regex =
    /\\(parencite|textcite|parencites|textcites|citeauthor|citeyear)(((\[[^\]]*\])?(\[[^\]]*\])?\{([^\}]*)\})+)/g
  let modifiedDocument = document
  const citations: CitationObject[] = []

  let match
  while ((match = regex.exec(document)) !== null) {
    const [, type, citationList] = match
    const citationRegex = /(\[[^\]]*\])?(\[[^\]]*\])?\{([^\}]*)\}/g
    let citationMatch
    const currentCitations: CitationObject[] = []
    let replacement = ''

    while ((citationMatch = citationRegex.exec(citationList)) !== null) {
      const [, prefix, suffix, key] = citationMatch
      const citation: CitationObject = {
        key,
        type: type.replace(/cites?/g, ''),
        position: 'middle', // Initialize with 'middle', we'll update this later
      }

      if (prefix?.length && suffix?.length) {
        citation.prefix = prefix.slice(1, -1)?.replace(/\\.*?\{(.*?)\}/g, '$1')
        citation.suffix = suffix.slice(1, -1)?.replace(/\\.*?\{(.*?)\}/g, '$1')
      }

      if (prefix?.length && !suffix?.length) {
        citation.suffix = prefix.slice(1, -1)?.replace(/\\.*?\{(.*?)\}/g, '$1')
      }

      currentCitations.push(citation)
    }

    // Update the 'position' property based on the number of citations
    const numCitations = currentCitations.length
    if (numCitations === 1) {
      currentCitations[0].position = 'alone'
    } else {
      currentCitations[0].position = 'first'
      currentCitations[numCitations - 1].position = 'last'
    }

    citations.push(...currentCitations)

    if (!callback) {
      continue
    }

    // Process the current citations using the provided callback function
    for (const citation of currentCitations) {
      replacement += callback(citation)
    }

    // Replace the matched citation in the document with the processed result
    modifiedDocument = modifiedDocument.replace(match[0], replacement)
  }

  if (!callback) {
    return citations
  }

  return modifiedDocument
}
