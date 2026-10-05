/**
 * Local taxes of a year as a PDF (lib/local-taxes/export-local-taxes.service.tsx):
 * the CFE from the avis, its acompte and balance, the CVAE from the value
 * added of the books, the plafonnement estimate and the deadlines with their
 * status. A worksheet, never an official form.
 */

import React from 'react'
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { LocalTaxesView } from '@/lib/local-taxes/load-local-taxes.service'
import { formatAmount } from '../utils'

const styles = StyleSheet.create({
  page: { padding: 24, fontSize: 8.5, fontFamily: 'Helvetica', backgroundColor: '#ffffff', color: '#000' },
  header: { borderBottom: '1 solid #000', paddingBottom: 4, marginBottom: 8 },
  company: { fontSize: 12, fontWeight: 'bold' },
  meta: { fontSize: 8, marginTop: 2 },
  title: { fontSize: 11, fontWeight: 'bold', marginTop: 6 },
  row: { flexDirection: 'row', borderBottom: '1 solid #d0d0d0', paddingVertical: 2 },
  label: { flex: 1, paddingRight: 4 },
  amount: { width: 90, textAlign: 'right' },
  status: { width: 70, textAlign: 'right' },
  section: { fontSize: 9.5, fontWeight: 'bold', marginTop: 10, marginBottom: 3 },
  item: { fontSize: 8, marginBottom: 2 },
})

const money = (cents: number | null | undefined) => (cents === null || cents === undefined ? 'non connu' : formatAmount(cents / 100))
const frDay = (iso: string) => iso.split('-').reverse().join('/')

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row} wrap={false}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.amount}>{value}</Text>
    </View>
  )
}

export function LocalTaxesPDF({ view, companyName, generatedOn, statusText }: { view: LocalTaxesView; companyName: string; generatedOn: string; statusText: string }) {
  const { cfe, cvae } = view
  const c = cvae.computation
  return (
    <Document title={`Impôts locaux ${view.year} ${companyName}`}>
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.header}>
          <Text style={styles.company}>{companyName}</Text>
          <Text style={styles.title}>Impôts locaux {view.year}&nbsp;: CFE et CVAE</Text>
          <Text style={styles.meta}>Document de travail établi par Kledg le {frDay(generatedOn)}&nbsp;: les déclarations et les paiements se font sur impots.gouv.fr.</Text>
        </View>

        <Text style={styles.section}>Cotisation foncière des entreprises</Text>
        <Row label="Avis d’imposition" value={money(cfe.avis?.totalCents)} />
        <Row label="Acompte du 15 juin" value={money(cfe.schedule.acompteCents)} />
        <Row label="Solde du 15 décembre" value={money(cfe.schedule.balanceCents)} />
        <Row label={`Charge prévue au compte ${cfe.expected.account.code}`} value={money(cfe.expected.cents)} />

        <Text style={styles.section}>Cotisation sur la valeur ajoutée des entreprises</Text>
        <Text style={styles.item}>{statusText}</Text>
        {c && cvae.books ? (
          <>
            <Row label="Chiffre d’affaires" value={money(cvae.books.turnoverCents)} />
            <Row label="Valeur ajoutée retenue" value={money(c.valueAdded.cents)} />
            {cvae.adjustments.map((a) => (
              <Row key={a.id} label={`Ajustement : ${a.label}`} value={money(a.amountCents)} />
            ))}
            <Row label="Taux effectif" value={c.rateLabel} />
            <Row label="CVAE brute" value={money(c.grossCents)} />
            <Row label="Dégrèvement" value={money(c.degrevementCents)} />
            <Row label="CVAE" value={money(c.cvaeCents)} />
            {c.complementaryCents > 0 ? <Row label="Contribution complémentaire (2025)" value={money(c.complementaryCents)} /> : null}
            <Row label="Total" value={money(c.totalCents)} />
          </>
        ) : null}
        {view.plafonnement ? <Row label="Plafonnement en fonction de la valeur ajoutée (estimation)" value={money(view.plafonnement.excessCents)} /> : null}

        <Text style={styles.section}>Échéances</Text>
        {view.deadlines.map((d) => (
          <View key={d.id} style={styles.row} wrap={false}>
            <Text style={styles.label}>
              {frDay(d.date)} {d.label}
            </Text>
            <Text style={styles.status}>{d.status.label}</Text>
          </View>
        ))}

        <Text style={styles.section}>Sources</Text>
        {view.sources.map((s) => (
          <Text key={s.url + s.label} style={styles.item}>
            {s.label}
          </Text>
        ))}
      </Page>
    </Document>
  )
}
