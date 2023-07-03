import { JSDOM } from 'jsdom'
import {
  Schema,
  DOMParser,
  Node as ProseMirrorNode,
  Mark as ProseMirrorMark,
} from 'prosemirror-model'

function parseHtml(html: string): HTMLElement {
  const { window } = new JSDOM()
  const parser = new window.DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  return doc.body
}

function createNodeFromElement(
  element: HTMLElement,
  schema: Schema
): ProseMirrorNode | ProseMirrorMark | null {
  const tagName = element.tagName.toLowerCase()
  const attrs: { [key: string]: string } = {}
  for (let i = 0; i < element.attributes.length; i++) {
    const { name, value } = element.attributes[i]
    attrs[name] = value
  }
  const textContent = element.textContent
  if (['em', 'i', 'strong', 'b', 'a'].includes(tagName) && !textContent) {
    return null
  }
  switch (tagName) {
    case 'p':
      return schema.nodes.paragraph.create(
        attrs,
        parseContents(element, schema)
      )
    case 'i':
    case 'em':
      return schema.text(textContent, schema.marks.em.create(attrs))
    case 'strong':
    case 'b':
      return schema.text(textContent, schema.marks.strong.create(attrs))
    case 'a':
      if (
        attrs.href &&
        (attrs.href.startsWith('http://') || attrs.href.startsWith('https://'))
      ) {
        return schema.marks.link.create({ ...attrs, target: '_blank' })
      }
      break
  }
  return null
}

function parseContents(
  element: HTMLElement,
  schema: Schema
): Array<ProseMirrorNode | ProseMirrorMark> {
  const nodes: Array<ProseMirrorNode | ProseMirrorMark> = []
  for (let i = 0; i < element.childNodes.length; i++) {
    const child = element.childNodes[i]
    if (child.nodeType === 3) {
      // find strings that start with https:// or http://
      // and wrap them in a link

      const text = child.textContent || ''
      const matches = text.match(/(https?:\/\/[^\s]+)/g)
      if (matches) {
        const parts = text.split(matches[0])
        parts[0] && nodes.push(schema.text(parts[0]))
        nodes.push(
          schema.text(matches[0], [
            schema.marks.link.create({ href: matches[0] }),
          ])
        )
        parts[1] && nodes.push(schema.text(parts[1]))
      } else {
        nodes.push(schema.text(child.textContent || ''))
      }
    } else if (child.nodeType === 1) {
      const node = createNodeFromElement(child as HTMLElement, schema)
      if (node) {
        nodes.push(node)
      }
    }
  }
  return nodes
}

export function createParagraphNodeFromHtml(
  html: string,
  schema: Schema
): ProseMirrorNode {
  const body = parseHtml(html)
  const node = createNodeFromElement(body.firstChild as HTMLElement, schema)
  if (!node || !(node instanceof ProseMirrorNode)) {
    throw new Error('Invalid HTML')
  }
  return node
}
