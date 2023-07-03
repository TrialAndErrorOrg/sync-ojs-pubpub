import { writeFile } from 'fs/promises'
import { PubPub } from 'pubpub-client'

const pubpub = new PubPub(
  '27d9a5c8-30f3-44bd-971f-181388d53323',
  'https://journal.trialanderror.org'
)

const pub = await pubpub.pub.hacks.export({
  slug: 'pub/digital-nudges-ax/draft',
  format: 'json',
})

await writeFile('pub.json', JSON.stringify(pub, null, 2))
