import { Data as CSL } from 'csl-json'
function formatCitations(
  citationStore: Map<
    string,
    { citation: CSL; formattedCitation: string; key: string; raw: string }
  >
) {
  const formattedCitations = new Map()

  // Iterate through each citation in the original map
  for (const [key, citation] of citationStore.entries()) {
    const { citation: csl, formattedCitation, raw } = citation

    // Extract the necessary information from the CSL object
    const { author, issued, title } = csl

    // Format the author names
    const formattedAuthors =
      author?.map((name) => {
        const { given, family } = name
        const initials = given
          .split(' ')
          .map((word) => word.charAt(0))
          .join('. ')
        return `${initials} ${family}`
      }) ?? []

    // Format the date
    const year = issued?.['date-parts']?.[0]?.[0]

    // Format the title
    const formattedTitle = title?.toLowerCase()

    // Generate the citation key
    const citationKey = generateCitationKey(
      formattedCitation,
      formattedAuthors,
      year,
      formattedTitle,
      formattedCitations
    )

    // Add the formatted citation to the new map
    formattedCitations.set(key, {
      citation: csl,
      formattedCitation: citationKey,
      key,
      raw,
    })
  }

  return formattedCitations
}

function generateCitationKey(
  currentCitation: {
    citation: CSL
    formattedCitation: string
    key: string
    raw: string
  },
  formattedCitations: Map<
    string,
    { citation: CSL; formattedCitation: string; key: string; raw: string }
  >
) {
  const { citation: csl, formattedCitation } = currentCitation
  const { author, issued } = csl

  // Check if there are any existing citations with the same formatted citation
  const existingCitations = [...formattedCitations.values()].filter(
    (citation) => citation.formattedCitation === formattedCitation
  )

  // If there are no existing citations, use the basic format
  if (existingCitations.length === 0) {
    return formattedCitation
  }

  // If all the authors are the same, add a suffix to differentiate them
  const sameAuthors = existingCitations.filter((citation) =>
    citation.citation?.author?.every((auth, i) => {
      return (
        auth.given === author?.[i].given && auth.family === author?.[i].family
      )
    })
  )

  //   if (existingCitations.length === 1) {
  //     const suffix = getSuffix(existingCitations[0].formattedCitation)
  //     return `(${authors[0]}, ${year}${suffix})`
  //   }

  // If the first author is the same in all existing citations, add a suffix to differentiate them
  const firstAuthor = author?.[0]
  const sameFirstAuthor = existingCitations.every((citation) =>
    citation.formattedCitation.startsWith(`(${firstAuthor?.family}`)
  )
  if (sameFirstAuthor) {
    const suffix = getSuffix(
      existingCitations[existingCitations.length - 1].formattedCitation
    )
    return `(${author?.[0]?.family}, ${year}${suffix})`
  }

  // If only the first author is different in the existing citations, add initials to differentiate them
  const sameFirstAuthorInitials = existingCitations.every((citation) => {
    const existingInitials = citation.formattedCitation.match(/\b([A-Z])\./g)
    return existingInitials?.[0] === `${author?.[0]?.given?.charAt(0)}.`
  })
  if (sameFirstAuthorInitials) {
    const initials = getInitials(author, existingCitations)
    return `(${initials}, ${year})`
  }

  // Otherwise, find the minimum number of authors that is different
  const differentAuthors = getDifferentAuthors(author, existingCitations)
  const differentAuthorCount = differentAuthors.length
  const sameAuthorCount = (author?.length ?? 0) - differentAuthorCount
  const authorList = differentAuthors.concat(['et al.'])
  const authorString = authorList.join(', ')
  return `(${authorString}, ${year})`
}

function getSuffix(citationKey: string) {
  const matches = citationKey.match(/([a-z])$/)
  if (matches) {
    const suffix = String.fromCharCode(matches[1].charCodeAt(0) + 1)
    return suffix
  } else {
    return 'a'
  }
}

function getInitials(
  author: NonNullable<CSL['author']>,
  existingCitations: {
    citation: CSL
    formattedCitation: string
    key: string
    raw: string
  }[]
) {
  const existingInitials = existingCitations
    .map((citation) => citation.formattedCitation.match(/\b([A-Z])\./g))
    .flat()
  const usedInitials = existingInitials.filter(
    (initial) =>
      initial && initial.startsWith(`${author[0]?.given?.charAt(0)}.`)
  )
  const newInitial =
    usedInitials.length === 0
      ? author[0].given?.charAt(0)
      : author[0].given?.charAt(1)
  const initials = `${newInitial}. ${author
    .slice(1)
    .map((name) => name.family)
    .join(', ')}`
  return initials
}

function getDifferentAuthors(
  author: NonNullable<CSL['author']>,
  existingCitations: {
    citation: CSL
    formattedCitation: string
    key: string
    raw: string
  }[]
) {
  const differentAuthors = []
  for (let i = 0; i < author.length; i++) {
    const auth = author[i]
    const sameAuthor = existingCitations.some((citation) => {
      const { author: existingAuthors } = citation.citation
      return existingAuthors?.some((existingAuthor) => {
        return (
          existingAuthor.family === auth.family &&
          existingAuthor.given === auth.given
        )
      })
    })
    if (!sameAuthor) {
      differentAuthors.push(author)
    }
  }
  return differentAuthors
}
