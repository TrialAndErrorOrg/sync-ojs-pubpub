import { AttributionsPayload, PubPub, allowedMimeTypes } from 'pubpub-client'
import { postProcessGen } from './postProcess'
import { doUnspeakableThings } from './unspeakableThings'
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function doSomething(settings: {
  submissionId: number
  publicationId?: number
  importAbstract?: boolean
  importReferences?: boolean
}) {
  const defaultSettings = {
    publicationId: settings.submissionId,
    importAbstract: true,
    importReferences: true,
  }

  const { importAbstract, submissionId, publicationId, importReferences } = {
    ...defaultSettings,
    ...settings,
  }

  const pubpub = new PubPub(
    process.env.COMMUNITY_ID!,
    process.env.COMMUNITY_URL!
  )

  await pubpub.login(process.env.EMAIL!, process.env.PASSWORD!)

  let pubId: string | undefined

  try {
    const pubres = await fetch(
      `${process.env.OJS_API}/submissions/${submissionId}/publications/${publicationId}?apiToken=${process.env.OJS_TOKEN}`
    )

    const pubdata = (await pubres.json()) as Publication

    console.log(pubdata)

    let slug: string | undefined

    // pubId = pubdata.urlPath
    // if url path doesnt look like a uuid, then we need to create a new pub
    if (
      !pubId?.match(
        /[a-z0-9]{8}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{12}/
      ) ||
      true
    ) {
      const pub = await pubpub.pub.create()
      console.log({ pub })
      pubId = pub.id
      slug = pub.slug
      console.log('✅ Successfully created pub')
    }

    const coolerSlug =
      pubdata.title.en_US
        ?.replace(/[^a-zA-Z0-9]+/g, '-')
        ?.toLowerCase()
        ?.split('-')
        ?.slice(0, 3)
        ?.join('-') + 'xx'

    const pdfGalley =
      pubdata.galleys.find((galley) => galley.file.documentType === 'pdf') ??
      ({} as Galley)

    const { submissionFileId } = pdfGalley

    const pdfFileFetch = await fetch(
      `${process.env.OJS_API}/_files/${submissionFileId}?apiToken=${process.env.OJS_TOKEN}`
    )

    const pdfFile = await pdfFileFetch.blob()

    // map the data to pubpub

    const possibleImage = pubdata?.coverImage?.en_US?.dateUploaded
      ? `https://submit.trialanderror.org/public/journals/1/${pubdata.coverImage.en_US.uploadName}`
      : undefined
    const input: Parameters<typeof pubpub.pub.modify>[1] = {
      title: pubdata.title.en_US,
      avatar: possibleImage,
      doi: pubdata['pub-id::doi'] || '',
      downloads: pdfFile
        ? [
            {
              fileName: 'main.pdf',
              fileOrPath: pdfFile,
              mimeType: 'application/pdf',
            },
          ]
        : undefined,
      slug: coolerSlug,
      ...(possibleImage
        ? {
            pubHeaderTheme: {
              backgroundImage: possibleImage,
            },
          }
        : {}),
    }

    const modified = await pubpub.pub.modify(pubId, input)

    console.log('✅ Successfully modified pub')

    console.log(modified)

    console.log('Removing old attributions...')
    const attribution = await pubpub.pub.attributions.get(pubId)

    const removedAttributions = await Promise.all(
      attribution.map(async (attr) =>
        pubpub.pub.attributions.remove({
          pubId: pubId as string,
          id: attr.id as string,
        })
      )
    )

    console.log('✅ Successfully removed old attributions')

    // set the new attributions to the authors minus the current user

    const newAttributions: AttributionsPayload[] = pubdata.authors.map(
      (author, idx) => {
        const order =
          1 - (pubdata.authors.length - idx) / pubdata.authors.length
        const name =
          author.preferredPublicName.en_US ||
          `${author.givenName.en_US ?? ''} ${
            author.familyName.en_US ?? ''
          }`.trim()
        console.log(name, order)
        return {
          isAuthor: true,
          pubId: pubId as string,
          name,
          // roles: 'Writing – Original Draft Preparation',
          affiliation: author.affiliation.en_US,
          orcid: author.orcid,
          // seq goes from 0 to n, but order goes from 1 to 0, so we do some math
          order,
        }
      }
    )

    console.log('Adding attributions...')
    const addedAttributions = await Promise.all(
      newAttributions.map(async (attr) =>
        pubpub.pub.attributions.create({
          ...attr,
        })
      )
    )

    console.log('✅ Added attributions')

    console.log('Updating attributions to include role and orcid...')
    const updatedAttributionsToIncludeRoleAndOrid = await Promise.all(
      addedAttributions.map(async (attr) => {
        const corresponding = newAttributions.find(
          (newAttr) => newAttr.name === attr.name
        )

        return pubpub.pub.attributions.modify({
          pubId: pubId as string,
          // roles: ['Writing – Original Draft Preparation'],
          id: attr.id,
          orcid: corresponding?.orcid?.replace(/https?:\/\/orcid.org\//, ''),
          affiliation: corresponding?.affiliation || undefined,
        })
      })
    )

    console.log('✅ Updated attributions to include role and orcid')

    const texBibGalleys = pubdata.galleys.filter((galley) =>
      ['tex', 'bib'].includes(galley.file.path.split('.').pop() ?? 'docx')
    )

    const mediaGalleys = pubdata.galleys.filter((galley) =>
      galley.label.includes('media')
    )

    const mappedFilesPromise = downloadGalleys(texBibGalleys)
    const mappedMediaPromise = downloadGalleys(mediaGalleys)

    const [mappedFiles, mappedMedia] = await Promise.all([
      mappedFilesPromise,
      mappedMediaPromise,
    ])

    console.log('Downloading galleys...')

    const texFile = findFileByExtension(mappedFiles, 'tex')
    const bibFile = findFileByExtension(mappedFiles, 'bib')
    const texText = doUnspeakableThings(await (texFile?.file as Blob).text())
    const bibText = await (bibFile?.file as Blob).text()

    const mappedFilesWithModifiedTex = mappedFiles.map((file) => {
      console.log(file)
      if (Array.isArray(file)) {
        return file.map((f) => {
          if (f.fileName.endsWith('.tex')) {
            return {
              ...f,
              file: new Blob([texText], { type: 'text/x-tex' }),
            }
          }
          return f
        })
      }
      if (file.fileName.endsWith('.tex')) {
        return {
          ...file,
          file: new Blob([texText], { type: 'text/x-tex' }),
        }
      }

      return file
    })

    console.log('✅ Downloaded galleys!')

    const { abstract, funding } = pubdata

    const keywords = pubdata.keywords.en_US?.join(', ')

    const importedFiles = await pubpub.pub.hacks.import(
      `pub/${coolerSlug}`,

      [...mappedMedia, ...mappedFilesWithModifiedTex],

      postProcessGen({
        tex: texText,
        abstract: abstract.en_US,
        keywords,
        bib: bibText,
        funding,
        doi: pubdata['pub-id::doi'] ?? '10.36850/e1',
      })
    )

    console.log('✅ Successfully imported references!')

    console.log('Setting metadata on OJS side...')
    // set the publicationId to the pubId
    const updated = await fetch(
      `${process.env.OJS_API}/submissions/${submissionId}/publications/${publicationId}?apiToken=${process.env.OJS_TOKEN}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          publicationId: pubId,
        }),
      }
    )

    console.log('✅ Successfully set metadata on OJS side!')

    await sleep(30000)

    const removed = await pubpub.pub.remove(pubId)
    if (removed) {
      console.log(`Successfully removed ${slug}`)
    }

    try {
    } catch (e) {
      const removed = await pubpub.pub.remove(pubId)
      if (removed) {
        console.log(`Successfully removed ${slug}`)
      }
    }
  } catch (e) {
    console.error(e)
    if (pubId) {
      const removed = await pubpub.pub.remove(pubId)
      if (removed) {
        console.log(`Successfully removed pub`)
      }
    }
    await pubpub.logout()
  }
}

type NewType = Funding

interface Publication {
  _href: string
  abstract: Abstract
  accessStatus: number
  authors: Author[]
  authorsString: string
  authorsStringShort: string
  categoryIds: any[]
  citations: string[]
  citationsRaw: string
  copyrightHolder: Abstract
  copyrightYear?: any
  coverImage: CoverImage
  coverage: Abstract
  datePublished?: any
  disciplines: Disciplines
  doiSuffix?: any
  fullTitle: Abstract
  funding: NewType
  galleys: Galley[]
  hideAuthor?: any
  id: number
  issueId?: any
  keywords: Keywords
  languages: Disciplines
  lastModified: string
  licenseUrl?: any
  locale: string
  pages?: any
  prefix: Abstract
  primaryContactId: number
  'pub-id::doi': string
  'pub-id::publisher-id'?: any
  rights: Abstract
  sectionId: number
  seq: number
  source: Abstract
  status: number
  subjects: Disciplines
  submissionId: number
  subtitle: Abstract
  supportingAgencies: Keywords
  title: Abstract
  type: Abstract
  urlPath?: any
  urlPublished: string
  version: number
}

interface Keywords {
  en_US: string[]
}

interface Galley {
  doiSuffix?: any
  file: File
  id: number
  isApproved: boolean
  label: string
  locale: string
  'pub-id::doi'?: any
  'pub-id::publisher-id'?: any
  publicationId: number
  seq: number
  submissionFileId: number
  urlPublished: string
  urlRemote: string
}

interface File {
  _href: string
  assocId: number
  assocType: number
  caption?: any
  copyrightOwner?: any
  createdAt: string
  creator: Abstract
  credit?: any
  dateCreated?: any
  dependentFiles: any[]
  description: Abstract
  documentType: string
  doiSuffix?: any
  fileId: number
  fileStage: number
  genreId: number
  id: number
  language?: any
  locale: string
  mimetype: string
  name: Abstract
  path: string
  'pub-id::doi'?: any
  publisher: Abstract
  revisions: any[]
  source: Abstract
  sourceSubmissionFileId?: any
  sponsor: Abstract
  subject: Abstract
  submissionId: number
  terms?: any
  updatedAt: string
  uploaderUserId: number
  url: string
  viewable?: any
}

interface Disciplines {
  en_US: any[]
}

interface CoverImage {
  en_US: EnUS
}

interface EnUS {
  dateUploaded: string
  uploadName: string
  altText: string
}

interface Author {
  affiliation: Abstract
  email: string
  familyName: Abstract
  givenName: Abstract
  id: number
  includeInBrowse: boolean
  orcid: string
  orcidAccessDenied?: any
  orcidAccessExpiresOn: string
  orcidAccessScope: string
  orcidAccessToken: string
  orcidEmailToken?: any
  orcidRefreshToken: string
  orcidSandbox?: any
  orcidWorkPutCode?: any
  preferredPublicName: Abstract
  publicationId: number
  seq: number
  submissionLocale: string
  userGroupId: number
}

interface Abstract {
  en_US: string
}

export interface Funding {
  [key: string]: {
    funderName: string
    funderIdentification: string
    funderAwards: string[]
  }
}

function findFileByExtension(
  mappedFiles: Parameters<PubPub['pub']['hacks']['import']>[1],
  extension: string
) {
  return !Array.isArray(mappedFiles[0])
    ? (mappedFiles as Exclude<typeof mappedFiles, any[][]>)?.find((file) =>
        file.fileName.endsWith(extension)
      )
    : (mappedFiles as Extract<typeof mappedFiles, any[][]>)
        ?.find((file) =>
          file.some((filee) => filee.fileName.endsWith(extension))
        )
        ?.find((file) => file.fileName.endsWith(extension))
}

async function downloadGalleys(
  galleys: Galley[]
): Promise<Parameters<PubPub['pub']['hacks']['import']>[1]> {
  return await Promise.all(
    galleys.map(async (galley) => {
      const file = await fetch(
        `${process.env.OJS_API}/_files/${galley.submissionFileId}?apiToken=${process.env.OJS_TOKEN}`
      ).then((res) => res.blob())
      return {
        fileName: galley.file.name.en_US,
        file,
        mimeType: galley.file.mimetype as (typeof allowedMimeTypes)[number],
      }
    })
  )
}
