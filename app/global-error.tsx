'use client'

/**
 * Last resort when the root layout itself fails: no theme, no providers, so
 * the markup is self-contained with inline styles.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="fr">
      <body
        style={{
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          margin: 0,
          minHeight: '100svh',
          display: 'grid',
          placeItems: 'center',
          padding: '1rem',
          color: '#0a0a0a',
          background: '#fafafa',
        }}
      >
        <main style={{ maxWidth: '28rem' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: '0 0 0.5rem' }}>
            Kledg n&apos;a pas pu démarrer
          </h1>
          <p style={{ color: '#525252', fontSize: '0.875rem', margin: '0 0 1rem' }}>
            Une erreur empêche l&apos;affichage de l&apos;application. Réessayez dans un instant.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              height: '2.25rem',
              padding: '0 1rem',
              borderRadius: '0.4rem',
              border: 0,
              background: '#0a0a0a',
              color: '#fff',
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            Réessayer
          </button>
        </main>
      </body>
    </html>
  )
}
