/**
 * Impôt sur les sociétés worksheet as a PDF
 * (lib/corporate-tax/export-corporate-tax.service.tsx): the tax result with
 * the lines of the 2033-B-SD or 2058-A-SD, the IS at 15 % and 25 %, the
 * contribution sociale, the balance and the acomptes of the next year, the
 * checks and what stays to fill by hand. A worksheet, never the official
 * form.
 */

import React from 'react'
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { CorporateTaxView } from '@/lib/corporate-tax/load-corporate-tax.service'
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
  code: { width: 36 },
  label: { flex: 1, paddingRight: 4 },
  amount: { width: 72, textAlign: 'right' },
  origin: { width: 52, textAlign: 'right', color: '#444' },
  section: { fontSize: 9.5, fontWeight: 'bold', marginTop: 10, marginBottom: 3 },
  item: { fontSize: 8, marginBottom: 2 },
})

const ORIGIN = { books: 'Comptes', group: 'Filiales', manual: 'Saisi', total: 'Total' } as const
const money = (cents: number | null) => (cents === null ? 'à calculer' : formatAmount(cents / 100))
const frDay = (iso: string) => iso.split('-').reverse().join('/')

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row} wrap={false}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.amount}>{value}</Text>
    </View>
  )
}

export function CorporateTaxPDF({ view, companyName, generatedOn }: { view: CorporateTaxView; companyName: string; generatedOn: string }) {
  const c = view.computation
  const fy = view.fiscalYear
  return (
    <Document title={`IS ${fy?.year ?? ''} ${companyName}`}>
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.header}>
          <Text style={styles.company}>{companyName}</Text>
          <Text style={styles.title}>Préparation de l’impôt sur les sociétés, exercice {fy?.year}</Text>
          <Text style={styles.meta}>{view.formTitle}</Text>
          {fy ? <Text style={styles.meta}>Exercice du {frDay(fy.startDate)} au {frDay(fy.endDate)}</Text> : null}
          <Text style={styles.meta}>Document de travail établi par Kledg le {frDay(generatedOn)}&nbsp;: la déclaration et les relevés se déposent sur impots.gouv.fr.</Text>
          {!view.reliable ? <Text style={styles.warning}>Des contrôles signalent que les chiffres sont incomplets&nbsp;: voir la liste des contrôles avant de déclarer.</Text> : null}
        </View>

        <Text style={styles.section}>Résultat fiscal</Text>
        <View style={styles.headRow} fixed>
          <Text style={styles.code}>Ligne</Text>
          <Text style={styles.label}>Libellé</Text>
          <Text style={styles.amount}>Comptes</Text>
          <Text style={styles.amount}>À déclarer (€)</Text>
          <Text style={styles.origin}>Origine</Text>
        </View>
        {c?.lines.map((line) => (
          <View key={line.id} style={styles.row} wrap={false}>
            <Text style={styles.code}>{line.formLine ?? ''}</Text>
            <Text style={styles.label}>{line.label}</Text>
            <Text style={styles.amount}>{money(line.amountCents)}</Text>
            <Text style={styles.amount}>{String(line.euros)}</Text>
            <Text style={styles.origin}>{ORIGIN[line.origin]}</Text>
          </View>
        ))}

        {c ? (
          <View>
            <Text style={styles.section}>Impôt sur les sociétés</Text>
            <Row label={`Taux réduit de 15 % sur ${money(c.reducedRate.baseCents)} €`} value={money(c.reducedRate.taxCents)} />
            <Row label={`Taux normal de 25 % sur ${money(c.normalRate.baseCents)} €`} value={money(c.normalRate.taxCents)} />
            <Row label="Impôt sur les sociétés" value={money(c.corporateTaxCents)} />
            <Row label={c.socialContribution.exempt ? 'Contribution sociale (exonérée)' : 'Contribution sociale de 3,3 %'} value={money(c.socialContribution.cents)} />
            <Row label="Crédits d’impôt" value={money(c.creditsCents)} />
            <Row label="Total de l’exercice" value={money(c.totalCents)} />
          </View>
        ) : null}

        {view.balance ? (
          <View>
            <Text style={styles.section}>Relevé de solde (2572-SD)</Text>
            <Row label={`Acomptes versés pour l’exercice`} value={money(view.balance.paidCents)} />
            <Row
              label={`${view.balance.balanceCents >= 0 ? 'Solde à payer' : 'Excédent à demander en remboursement'}${view.balance.deadline ? `, au plus tard le ${frDay(view.balance.deadline.date)}` : ''}`}
              value={money(Math.abs(view.balance.balanceCents))}
            />
          </View>
        ) : null}

        {view.acomptes ? (
          <View>
            <Text style={styles.section}>Acomptes de l’exercice {view.acomptes.exercice.year} (2571-SD)</Text>
            {view.acomptes.items.map((item) => (
              <Row key={item.number} label={`Acompte n° ${item.number}, le ${frDay(item.date)} : ${item.note}`} value={money(item.amountCents)} />
            ))}
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
