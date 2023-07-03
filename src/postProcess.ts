import { PubPub } from 'pubpub-client'
import {
  Fragment,
  Node,
  DOMParser,
  SchemaSpec,
  Schema,
} from 'prosemirror-model'
import { CitationObject, findCitations } from './texMap'
import { Data as CSL } from 'csl-json'
import { JSDOM } from 'jsdom'
// @ts-expect-error Citation-js is not typed
import Cite from 'citation-js'
import { writeFile } from 'fs/promises'
import { createParagraphNodeFromHtml } from './createParagraphNodeFromHTML'
import { writeFileSync } from 'fs'
import { Funding } from '.'
import { extractFootnotesAndNonFootnotes } from './extractFootnotesAndNonFootnotes'

export function formatCitation(
  citation: CitationObject,
  citationApa: string
): string {
  const prefix = citation.prefix ? `${citation.prefix} ` : ''
  const suffix = citation.suffix ? `, ${citation.suffix}` : ''
  const bareCitation = citationApa.replace('(', '').replace(')', '')
  return `${prefix}${bareCitation}${suffix}`
}

const getBibtexKey = (citation: string) => citation.match(/@.*?\{(.*),/)?.[1]

type CitationStore = Map<
  string,
  {
    citation: CSL
    formattedCitation: string
    key: string
    raw: string
  }
>

export const postProcessGen = ({
  tex,
  bib,
  funding,
  abstract,
  keywords,
  doi,
}: {
  tex: string
  bib?: string
  funding?: Funding
  abstract?: string
  keywords?: string
  doi?: string
}) => {
  // const { nonFootnote, footnotes, captions } =
  // extractFootnotesAndNonFootnotes(tex)
  const citations = findCitations(tex)
  const jsdom = new JSDOM()
  const document = jsdom.window.document

  const tableCaptionsRegex =
    /\\begin\{table(\*)?\}(?:.*?)\\caption\{(.*?)\}\n/gms

  const tableCaptions: { caption: string; star: boolean }[] = []

  const bibByKey = bib?.split('@').reduce((acc, curr) => {
    const key = curr.match(/.*?\{(.*),/)?.[1]
    if (key) {
      acc[key] = `@${curr}`
    }
    return acc
  }, {} as Record<string, string>)

  let match
  while ((match = tableCaptionsRegex.exec(tex)) !== null) {
    tableCaptions.push({ caption: match[2], star: !!match[1] })
  }

  const postProcess: Parameters<PubPub['pub']['hacks']['import']>[2] = (
    doc,
    schema
  ) => {
    let citationIndex = 0
    let paragraphs: { index: number; node: Node }[] = []

    // first collect all the citations
    const citationStore = new Map<
      string,
      { citation: CSL; formattedCitation: string; key: string; raw: string }
    >()

    const cite = new Cite()
    const bibCite = new Cite(bib)

    doc.descendants((node, off, parent) => {
      if (node.type?.name !== 'citation') {
        return
      }
      const key = getBibtexKey(node.attrs.value)
      if (!key) return

      cite.add(node.attrs.value)

      citationStore.set(key, {
        citation: {} as CSL,
        formattedCitation: '',
        key,
        raw: node.attrs.value,
      })
    })

    const post = [...citationStore.keys()]
    const pre: string[] = []
    for (const [key, value] of citationStore) {
      citationStore.set(key, {
        ...value,
        formattedCitation: cite.format('citation', {
          template: 'apa-7',
          format: 'text',
          entry: [key],
          citationsPost: post,
          citationsPre: pre,
        }),
      })
      const currentEntry = post.shift()
      if (currentEntry) {
        pre.push(currentEntry)
      }
    }

    const secondAbstractIndices: number[] = []

    let tableCounter = 0

    let newChildren: Node[] = []
    doc.forEach((node, pos, index) => {
      const { citationIndex: citationIdx, citationNode } =
        traverseAndModifyTree({
          index,
          node,
          schema,
          citationStore,
          citationIndex,
          citations,
        })

      citationIndex = citationIdx
      newChildren.push(citationNode)
    })

    doc = Fragment.fromArray(newChildren)

    doc.forEach((paragraph, off, i) => {
      let outputs: { index: number; node: Node }[] = []

      if (
        paragraph.textContent === 'Abstract' &&
        paragraph.type.name === 'heading' &&
        paragraph.attrs.level === 1 &&
        (abstract || paragraph.attrs.id !== 'abstract')
      ) {
        secondAbstractIndices.push(i)
      }

      // set table to smaller font size and breakout
      if (paragraph.type === schema.nodes.table) {
        const numberOfColumns = paragraph.content.lastChild?.childCount || 0

        // const correctTable = schema.nodes.table.create(
        const attrs = {
          ...paragraph.attrs,
          size: numberOfColumns > 5 ? '75' : '50',
          align: 'breakout',
          smallerFont: true,
        }

        const nextParagraph = doc.maybeChild(i + 1)

        const caption = tableCaptions[tableCounter]?.caption
        const isStar = tableCaptions[tableCounter]?.star

        tableCounter++
        if (!nextParagraph || !caption) {
          console.warn('Could not find caption for table')
          return
        }

        if (isStar) {
          paragraphs.push({
            index: i,
            node: schema.nodes.paragraph.create({}, [
              schema.text(`Table ${tableCounter}. `, [
                schema.marks.strong.create(),
              ]),
              schema.text(caption, [schema.marks.em.create()]),
            ]),
          })

          paragraphs.push({
            index: i + 1,
            node: schema.nodes.table.create(attrs, paragraph.content),
          })
        } else {
          //
          paragraphs.push({
            index: i,
            node: schema.nodes.paragraph.create({}, [
              schema.text(`Table ${tableCounter}. `, [
                schema.marks.strong.create(),
              ]),
              schema.text(nextParagraph.textContent ?? caption, [
                schema.marks.em.create(),
              ]),
            ]),
          })

          paragraphs.push({
            index: i + 1,
            node: schema.nodes.table.create(attrs, paragraph.content),
          })
        }
        // outputs.push({ index: i, node: correctTable })
      }

      let contents: Fragment | null = null
      outputs.forEach((output) => {
        contents = (contents || paragraph.content).replaceChild(
          output.index,
          output.node
        )
      })

      contents && paragraphs.push({ index: i, node: paragraph.copy(contents) })
    })

    paragraphs.forEach((paragraph) => {
      doc = doc.replaceChild(paragraph.index, paragraph.node)
    })

    // remove second abstract
    if (secondAbstractIndices) {
      secondAbstractIndices.forEach((index) => {
        console.log(`removing abstract at ${index}`)
        doc = doc.replaceChild(index, schema.nodes.paragraph.create())
      })
    }

    // append references

    // const bib = cite.format('bibliography', {
    const formattedBib = (bib ? bibCite : cite).format('bibliography', {
      template: 'apa-7',
      format: 'html',
      lang: 'en-US',
    }) as string

    const bibParagraphs = formattedBib.split(/\n+/).filter(Boolean)
    // .map((paragraph) => {
    //   return paragraph.replace(/<(\/)?div/, '<$1p')
    // })

    const bbb = bibParagraphs
      .join('\n')
      .replace(/<div.*?>(.*)<\/div>/ms, '$1')
      ?.replace(/div/g, 'p')
      ?.split(/\n+/)
      ?.filter(Boolean)

    const badParsed = bbb.map((paragraph) =>
      createParagraphNodeFromHtml(paragraph, schema)
    )

    const bibFragment = Fragment.from(Fragment.from(badParsed))

    doc = doc.addToEnd(
      schema.nodes.heading.create({}, schema.text('References'))
    )
    doc = doc.append(bibFragment)

    let startFragment = Fragment.empty

    if (abstract) {
      startFragment = startFragment.addToEnd(
        schema.nodes.heading.create(
          { level: 1, id: 'abstract', fixedId: 'abstract' },
          schema.text('Abstract')
        )
      )

      const html = document.createElement('div')
      html.innerHTML = abstract

      const parsedDom = DOMParser.fromSchema(schema).parse(html)

      const abstractFragment = Fragment.from(parsedDom.content)

      startFragment = startFragment.append(abstractFragment)
    }

    if (keywords) {
      startFragment = startFragment.addToEnd(
        schema.nodes.paragraph.create({}, [
          schema.text('Keywords: ', [schema.mark('strong')]),
          schema.text(keywords, [schema.mark('em')]),
        ])
      )
    }

    if (doi) {
      startFragment = startFragment.addToEnd(
        schema.nodes.image.create({
          url: 'https://crossmark-cdn.crossref.org/widget/v2.0/logos/CROSSMARK_Color_horizontal.svg',
          size: 22,
          align: 'left',
          hideLabel: true,
          href: `https://crossmark.crossref.org/dialog?doi=${encodeURIComponent(
            doi
          )}&domain=journal.trialanderror.org&uri_scheme=https%3A&cm_version=v2.0`,
        })
      )

      // add two empty paragraphs
      startFragment = startFragment.addToEnd(schema.nodes.paragraph.create())
      startFragment = startFragment.addToEnd(schema.nodes.paragraph.create())
    }

    doc = startFragment.append(doc)
    writeFileSync('output.json', JSON.stringify(doc.toJSON(), null, 2))

    return doc
  }

  return postProcess
}

function modifyCitationNode({
  node,
  schema,
  citations,
  citationIndex,
  citationStore,
  index,
  parentNode,
}: {
  node: Node
  schema: Parameters<
    NonNullable<Parameters<PubPub['pub']['hacks']['import']>[2]>
  >[1]
  parentNode: Node | null
  index: number | null
  citations: CitationObject[]
  citationIndex: number
  citationStore: CitationStore
}) {
  // Get the sibling nodes
  // Perform your modification on the citation node
  // const modifiedNode = node.copy(node.attrs, node.content);
  const citation = citations[citationIndex]

  const bibtexKey = getBibtexKey(node.attrs.value)
  if (!bibtexKey) {
    console.warn('Could not find bibtex key')
    return { citationNode: node, citationIndex }
  }
  const citationApa = citationStore.get(bibtexKey)?.formattedCitation as string

  let customLabel = fixCitation(citation, citationApa)

  // outputs.push({
  //   index: idx,
  //   node: schema.nodes.citation.create({
  //     value: !bib
  //       ? node.attrs.value
  //       : bibByKey?.[bibtexKey] || node.attrs.value,
  //     customLabel,
  //   }),
  // })
  citationIndex += 1
  // console.log(customLabel)

  const modifiedNode = schema.nodes.citation.create(
    {
      value: node.attrs.value,
      customLabel,
    },
    node.content
  )

  // Replace the original node with the modified one

  return { citationNode: modifiedNode, citationIndex }
}

// function descend({
//   schema,
//   doc,
//   citations,
//   citationIndex,
//   citationStore,
// }: {
//   schema: Parameters<
//     NonNullable<Parameters<PubPub['pub']['hacks']['import']>[2]>
//   >[1]
//   citations: CitationObject[]
//   citationIndex: number
//   citationStore: CitationStore
//   doc: Fragment
// }) {
//   let document = doc
//   const ancestorStack: Array<{ node: Node; index: number }> = []
//   let currentNode: Node | null | undefined = doc.firstChild
//   let currentPos = 0
//   const { citation: citationNode } = schema.nodes

//   while (currentNode) {
//     if (currentNode.type === citationNode) {
//       const parentNode =
//         ancestorStack.length > 0
//           ? ancestorStack[ancestorStack.length - 1].node
//           : null
//       const index = parentNode
//         ? ancestorStack[ancestorStack.length - 1].index
//         : null
//       const { newDoc, citationIndex: newCitationIndex } = modifyCitationNode({
//         node: currentNode,
//         citationStore,
//         citationIndex,
//         schema,
//         citations,
//         document,
//         index,
//         nodePos: currentPos,
//         parentNode,
//       })

//       document = newDoc
//       citationIndex = newCitationIndex
//     }

//     // Descend to the first child if it exists
//     if (currentNode.childCount > 0) {
//       ancestorStack.push({ node: currentNode, index: 0 })
//       currentPos += 1
//       currentNode = currentNode.firstChild
//     } else {
//       // Move to the next sibling or ancestor's sibling
//       while (ancestorStack.length > 0) {
//         const ancestor = ancestorStack[ancestorStack.length - 1]
//         if (ancestor.index + 1 < ancestor.node.childCount) {
//           // Move to the next sibling
//           ancestor.index += 1
//           currentPos += currentNode?.nodeSize ?? 0
//           currentNode = ancestor.node.child(ancestor.index)
//           break
//         } else {
//           // Move up to the ancestor's sibling
//           ancestorStack.pop()
//           currentPos += currentNode?.nodeSize ?? 0
//           currentNode = undefined
//         }
//       }

//       // If there are no more ancestors, we're done traversing the tree
//       if (ancestorStack.length === 0) {
//         currentNode = undefined
//       }
//     }
//   }

//   return document
// }

const traverseAndModifyTree = ({
  node,
  parentNode = null,
  index = null,
  schema,
  citations,
  citationIndex,
  citationStore,
}: {
  node: Node
  parentNode?: Node | null
  index?: number | null
  schema: Parameters<
    NonNullable<Parameters<PubPub['pub']['hacks']['import']>[2]>
  >[1]
  citations: CitationObject[]
  citationIndex: number
  citationStore: CitationStore
}): { citationNode: Node; citationIndex: number } => {
  if (node.type.name === 'citation') {
    return modifyCitationNode({
      node,
      parentNode,
      index,
      schema,
      citationIndex,
      citations,
      citationStore,
    })
  }

  if (node.childCount > 0) {
    const newChildren: Node[] = []
    node.content.forEach((child, off, idx) => {
      const { citationIndex: newCitationIndex, citationNode } =
        traverseAndModifyTree({
          node: child,
          parentNode: node,
          index: idx,
          schema,
          citations,
          citationIndex,
          citationStore,
        })

      citationIndex = newCitationIndex
      newChildren.push(citationNode)
    })
    return {
      citationNode: node.type.create(node.attrs, Fragment.from(newChildren)),
      citationIndex,
    }
  }

  return {
    citationNode: node,
    citationIndex,
  }
}

export function fixCitation(citation: CitationObject, citationApa: string) {
  const formattedCitation = formatCitation(citation, citationApa)

  let customLabel = formattedCitation

  if (citation.type === 'text') {
    customLabel = `${
      citation.prefix ? `${citation.prefix} ` : ''
    }${citationApa.replace(/\((.*), (.*?)\)/, '$1 ($2')}${
      citation.suffix ? ` ${citation.suffix})` : ')'
    }`
  } else if (citation.type === 'year') {
    customLabel = citationApa.replace(/\((.*), (.*?)\)/, '$2')
  } else if (citation.type === 'author') {
    customLabel = citationApa.replace(/\((.*), (.*?)\)/, '$1')
  } else if (citation.position === 'last') {
    customLabel = `${formattedCitation})`
  } else if (citation.position === 'first') {
    customLabel = `(${formattedCitation}; `
  } else if (citation.position === 'middle') {
    customLabel = `${formattedCitation}; `
  } else {
    customLabel = `(${formattedCitation})`
  }
  return customLabel
}
