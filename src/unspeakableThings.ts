import Cite from 'citation-js'

import { extractFootnotesAndNonFootnotes } from './extractFootnotesAndNonFootnotes'
import { findCitations } from './texMap'
import { fixCitation } from './postProcess'
/**
 * Shitty function to remove things I don't want
 */
export function doUnspeakableThings(tex: string, bibliography?: string) {
  const bib =
    bibliography ||
    tex.replace(
      /.*\\begin\{filecontents\}\{.*?\}(.*?)\\end\{filecontents\}.*/gms,
      '$1'
    )
  const cite = new Cite(bib)
  let cleanerTex = tex
    .replace(/\\(begin|end){fullwidth}/gms, '')
    .replace(
      /(.*?\\begin{document}\n)(.*?)\\begin{originalPurpose}(.*?)\\end{originalPurpose}/gms,
      '$1\\section{Original Purpose}\n\n$3\n\n\\section{Introduction}\n\n$2'
    )
    .replace(
      /(.*?\\begin{document}\n)(.*?)\\begin{takeHomeMessage}(.*?)\\end{takeHomeMessage}/gms,
      '$1\\section{Take Home Message}\n\n$3\n\n$2'
    )
    .replace(/(figure|table)\*/g, '$1')

  console.log('Changed? ', cleanerTex !== tex)
  const { footnotes, captions } = extractFootnotesAndNonFootnotes(cleanerTex)
  console.log(captions)

  const keys = bib.match(/(?<=@.*?\{)(.*?)(?=,)/g)
  // ?.map((key) => key.slice(2, -1))

  ;[...captions, ...footnotes].forEach((footnote) => {
    const cites = findCitations(footnote, (citation) => {
      const citationApa = cite.format('citation', {
        template: 'apa-7',
        format: 'text',
        entry: [citation.key],
        citationsPost: keys,
      })
      const fixedCitation = fixCitation(citation, citationApa).replace(
        /(%|&)/g,
        '\\$1'
      )
      return fixedCitation
    })

    console.log(footnote, cites)
    cleanerTex = cleanerTex.replace(footnote, cites)
  })
  return cleanerTex
}
