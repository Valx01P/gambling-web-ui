// Reusable JSON-LD emitter. Renders the structured-data <script> with the
// canonical schema.org context. Keeps consumers tiny — they just hand us
// the data object.
//
// This is a server component (no 'use client') so the script tag is in the
// initial HTML response and Google can see it without waiting for hydration.

export default function JsonLd({ data }) {
  // Stringify once at render. The content is always trusted (we never
  // splice user input into the schema); dangerouslySetInnerHTML is the
  // standard React idiom for inline JSON-LD per Next.js docs.
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}

// Convenience builder for breadcrumb trails. Pass an array of
// `[name, url]` tuples; we emit a schema.org BreadcrumbList.
export function breadcrumbJsonLd(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, url], i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name,
      item: url,
    })),
  }
}
