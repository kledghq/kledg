import { getCurrentUser } from '@/lib/session'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/shared'
import { ReportsEmptyHint } from '@/components/features/onboarding/reports-empty-hint'
import { BarChart3, BookOpen, Contact, Download, FileText, Hourglass, ScrollText, Table, TrendingDown } from 'lucide-react'

const reports = [
  {
    title: 'Bilan',
    description: "Actif et passif de la société à la clôture de l'exercice",
    url: '/reports/balance-sheet',
    cta: 'Voir le bilan',
    icon: BarChart3,
  },
  {
    title: 'Compte de résultat',
    description: "Charges et produits de l'exercice",
    url: '/reports/income-statement',
    cta: 'Voir le compte de résultat',
    icon: TrendingDown,
  },
  {
    title: 'Balance',
    description: 'Soldes de tous les comptes sur la période',
    url: '/reports/trial-balance',
    cta: 'Voir la balance',
    icon: Table,
  },
  {
    title: 'Grand livre',
    description: 'Détail des mouvements par compte',
    url: '/reports/grand-livre',
    cta: 'Voir le grand livre',
    icon: BookOpen,
  },
  {
    title: 'Balance auxiliaire',
    description: 'Solde de chaque client et de chaque fournisseur, et la part non lettrée',
    url: '/reports/auxiliary-balance',
    cta: 'Voir la balance auxiliaire',
    icon: Contact,
  },
  {
    title: 'Balance âgée',
    description: "Créances et dettes non lettrées, classées par ancienneté de l'échéance",
    url: '/reports/aged-balance',
    cta: 'Voir la balance âgée',
    icon: Hourglass,
  },
  {
    title: 'Journal',
    description: 'Écritures classées par journal',
    url: '/reports/journal',
    cta: 'Voir le journal',
    icon: ScrollText,
  },
  {
    title: "Tableau d'amortissement",
    description: 'Dotations et valeurs nettes des immobilisations',
    url: '/reports/depreciation',
    cta: "Voir le tableau d'amortissement",
    icon: FileText,
  },
  {
    title: 'Export FEC',
    description: 'Fichier des écritures comptables au format FEC',
    url: '/reports/fec',
    cta: 'Exporter le FEC',
    icon: Download,
  },
]

export default async function ReportsPage({
  params,
}: {
  params: Promise<{ companyId: string }>
}) {
  const { companyId } = await params
  const user = await getCurrentUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="États"
        description="Consultez et exportez les états comptables de la société&nbsp;: bilan, compte de résultat, balance, grand livre, balances des tiers, journal, amortissements et FEC."
      />
      <ReportsEmptyHint companyId={companyId} />
      <div className="grid gap-4 lg:grid-cols-2">
        {reports.map((report) => (
          <Card key={report.url}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <report.icon aria-hidden className="text-muted-foreground size-4" />
                <CardTitle>{report.title}</CardTitle>
              </div>
              <CardDescription>{report.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/${companyId}${report.url}`}>{report.cta}</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
