import { postProcessGen } from './postProcess'
import document from './document-0.json'
import { Node, Schema } from 'prosemirror-model'
import schemaMarks from './schema-marks.json'
import schemaNodes from './schema-nodes.json'

import { describe, it, expect } from 'vitest'
import { readFile, writeFile } from 'fs/promises'
import { Fragment } from 'prosemirror-model'

const schema = new Schema({
  nodes: schemaNodes,
  marks: schemaMarks,
  topNode: 'doc',
})

const tex = await readFile(new URL('./test.tex.txt', import.meta.url), 'utf-8')
const bib = await readFile(new URL('./test.bib.txt', import.meta.url), 'utf-8')

describe('postProcessing', () => {
  it('should work', async () => {
    const postProcess = postProcessGen({
      tex,
      abstract: '<p> look this text baby </p>',
      doi: '10.36850/e3',
      keywords: 'googoo, gaga',
      bib,
    })
    console.log(document)
    const doc = Fragment.fromJSON(schema, document)

    const newDoc = postProcess(doc, schema)
    await writeFile(
      new URL('./with-citations.json', import.meta.url),
      JSON.stringify(newDoc.toJSON(), null, 2)
    )
    expect(postProcess).toBeDefined()
  })
})
