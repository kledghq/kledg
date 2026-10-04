/**
 * VAT return worksheet as a PDF (lib/vat-returns/export-vat-return.service.tsx):
 * the lines of the CA3 or the CA12 with their box codes, the amounts of the
 * books and the whole euros to type on impots.gouv.fr, the checks and what
 * stays to fill by hand. A worksheet, never the official form.
 */

import React from 'react'
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { VatReturnView } from '@/lib/vat-returns/load-vat-return.service'
import { formatAmount } from '../utils'

const styles = StyleSheet.create({
  page: { padding: 24, fontSize: 8.5, fontFamily: 'Helvetica', backgroundColor: '#ffffff', color: '#000' },
  header: { borderBottom: '1 solid #000', paddingBottom: 4, marginBottom: 8 },
  company: { fontSize: 12, fontWeight: 'bold' },
  meta: { fontSize: 8, marginTop: 2 },
  title: { fontSize: 11, fontWeight: 'bold', marginTop: 6 },
  warning: { fontSize: 8, marginTop: 4, padding: 4, border: '1 solid #000' },
  row: { flexDirection: 'row', borderBottom: '1 solid #d0d0d0', paddingVertical: 2 },
  headRow: { flexDirection: 'row', borderBottom: '1 solid #000', paddingVertical: 2, fontWeight: 'bold' },
  code: { width: 28 },
  box: { width: 32, color: '#444' },
  label: { flex: 1, paddingRight: 4 },
  amount: { width: 62, textAlign: 'right' },
  status: { width: 52, textAlign: 'right', color: '#444' },
  section: { fontSize: 9.5, fontWeight: 'bold', marginTop: 10, marginBottom: 3 },
  item: { fontSize: 8, marginBottom: 2 },
})

const euros = (value: number | null) => (value === null ? '' : String(value))
const books = (cents: number | null) => (cents === null ? '' : formatAmount(cents / 100))
const STATUS = { computed: 'Calculé', manual: 'À remplir', total: 'Total' } as const

export function VatReturnPDF({ view, companyName, generatedOn }: { view: VatReturnView; companyName: string; generatedOn: string }) {
  const period = view.period
  const computation = view.computation
  return (
    <Document title={`TVA ${period?.label ?? ''} ${companyName}`}>
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.header}>
          <Text style={styles.company}>{companyName}</Text>
          <Text style={styles.title}>Préparation de la déclaration de TVA, {period?.label}</Text>
          <Text style={styles.meta}>{view.formTitle}</Text>
          <Text style={styles.meta}>
            Période du {period?.start.split('-').reverse().join('/')} au {period?.end.split('-').reverse().join('/')}
            {view.deadline ? `, à déposer et payer au plus tard le ${view.deadline.date.split('-').reverse().join('/')}${view.deadline.estimated ? ' (jour indicatif)' : ''}` : ''}
          </Text>
          <Text style={styles.meta}>Document de travail établi par Kledg le {generatedOn.split('-').reverse().join('/')}&nbsp;: la déclaration se dépose sur impots.gouv.fr.</Text>
          {!view.reliable ? <Text style={styles.warning}>Des contrôles signalent que les chiffres sont incomplets&nbsp;: voir la liste des contrôles avant de déclarer.</Text> : null}
        </View>

        <View style={styles.headRow} fixed>
          <Text style={styles.code}>Ligne</Text>
          <Text style={styles.box}>Case</Text>
          <Text style={styles.label}>Libellé</Text>
          <Text style={styles.amount}>Base comptable</Text>
          <Text style={styles.amount}>Taxe comptable</Text>
          <Text style={styles.amount}>Base à déclarer</Text>
          <Text style={styles.amount}>Montant à déclarer</Text>
          <Text style={styles.status}>Origine</Text>
        </View>
        {computation?.lines.map((line) => (
          <View key={`${line.code}-${line.box}`} style={styles.row} wrap={false}>
            <Text style={styles.code}>{line.code}</Text>
            <Text style={styles.box}>{line.box ?? ''}</Text>
            <Text style={styles.label}>{line.label}</Text>
            <Text style={styles.amount}>{books(line.baseCents)}</Text>
            <Text style={styles.amount}>{books(line.amountCents)}</Text>
            <Text style={styles.amount}>{euros(line.base)}</Text>
            <Text style={styles.amount}>{euros(line.amount)}</Text>
            <Text style={styles.status}>{STATUS[line.status]}</Text>
          </View>
        ))}

        {computation?.acomptes ? (
          <View>
            <Text style={styles.section}>Acomptes de l’année suivante</Text>
            <Text style={styles.item}>
              {computation.acomptes.nextDue
                ? `Base (ligne 57) : ${computation.acomptes.nextBaseEuros} €. Acompte de juillet (55 %) : ${computation.acomptes.nextJulyEuros} €, acompte de décembre (40 %) : ${computation.acomptes.nextDecemberEuros} €.`
                : `Base (ligne 57) : ${computation.acomptes.nextBaseEuros} €, sous 1 000 € : pas d’acompte l’année suivante.`}
            </Text>
          </View>
        ) : null}

        <Text style={styles.section}>Contrôles</Text>
        {view.checks.map((check) => (
          <View key={check.id} wrap={false}>
            <Text style={styles.item}>
              {check.severity === 'blocking' ? '[À corriger] ' : check.severity === 'warning' ? '[À vérifier] ' : check.severity === 'info' ? '[Information] ' : '[OK] '}
              {check.title}. {check.detail}
            </Text>
            {(check.items ?? []).map((item) => (
              <Text key={item} style={styles.item}>
                {'    '}
                {item}
              </Text>
            ))}
          </View>
        ))}

        <Text style={styles.section}>Ce que Kledg ne peut pas savoir</Text>
        {view.notFromTheBooks.map((text) => (
          <Text key={text} style={styles.item}>
            - {text}
          </Text>
        ))}

        <Text style={styles.section}>Sources</Text>
        {view.sources.map((source) => (
          <Text key={source.url} style={styles.item}>
            {source.label}&nbsp;: {source.url}
          </Text>
        ))}
      </Page>
    </Document>
  )
}
