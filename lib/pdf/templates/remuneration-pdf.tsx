/**
 * "Rémunération et dividendes" simulation as a PDF
 * (lib/remuneration/export-remuneration.service.tsx): the inputs, the four
 * scenarios side by side with the same rows as the page, the notes, the
 * approximations and the sources. An indicative simulation, never advice.
 */

import React from 'react'
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { RemunerationView } from '@/lib/remuneration/load-remuneration.service'
import { breakdownRows, DISCLAIMER, SCENARIO_ORDER, STATUS_LABELS, TAXATION_LABELS } from '@/lib/remuneration/breakdown'
import { formatAmount } from '../utils'

const styles = StyleSheet.create({
  page: { padding: 24, fontSize: 8.5, fontFamily: 'Helvetica', backgroundColor: '#ffffff', color: '#000' },
  header: { borderBottom: '1 solid #000', paddingBottom: 4, marginBottom: 8 },
  company: { fontSize: 12, fontWeight: 'bold' },
  meta: { fontSize: 8, marginTop: 2 },
  title: { fontSize: 11, fontWeight: 'bold', marginTop: 6 },
  warning: { fontSize: 8, marginTop: 4, padding: 4, border: '1 solid #000' },
  row: { flexDirection: 'row', borderBottom: '1 solid #d0d0d0', paddingVertical: 2 },
  strong: { flexDirection: 'row', borderBottom: '1 solid #000', paddingVertical: 2, fontWeight: 'bold' },
  headRow: { flexDirection: 'row', borderBottom: '1 solid #000', paddingVertical: 2, fontWeight: 'bold' },
  label: { flex: 1, paddingRight: 4 },
  amount: { width: 82, textAlign: 'right' },
  section: { fontSize: 9.5, fontWeight: 'bold', marginTop: 10, marginBottom: 3 },
  item: { fontSize: 8, marginBottom: 2 },
})

const money = (cents: number) => formatAmount(cents / 100)
const frDay = (iso: string) => iso.split('-').reverse().join('/')
const percent = (bp: number) => `${(bp / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`

export function RemunerationPDF({ view, companyName, generatedOn }: { view: RemunerationView; companyName: string; generatedOn: string }) {
  const sim = view.simulation
  const inputs = view.inputs
  const fy = view.fiscalYear
  if (!sim || !inputs) return null
  const rows = breakdownRows(sim)
  return (
    <Document title={`Rémunération et dividendes ${fy?.year ?? ''} ${companyName}`}>
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.header}>
          <Text style={styles.company}>{companyName}</Text>
          <Text style={styles.title}>Rémunération et dividendes du dirigeant, exercice {fy?.year}</Text>
          {view.scenario ? <Text style={styles.meta}>Scénario enregistré «&nbsp;{view.scenario.name}&nbsp;»</Text> : null}
          <Text style={styles.meta}>Simulation établie par Kledg le {frDay(generatedOn)}, règles {view.rulesYear}.</Text>
          <Text style={styles.warning}>{DISCLAIMER}</Text>
        </View>

        <Text style={styles.section}>Hypothèses</Text>
        {[
          ['Résultat avant rémunération et impôt', money(inputs.resultBeforePayCents)],
          ['Statut du dirigeant', STATUS_LABELS[inputs.status]],
          ['Taux réduit de 15 % de l’impôt sur les sociétés', inputs.reducedRate ? `Oui, jusqu’à ${money(inputs.reducedRateCeilingCents)}` : 'Non'],
          ['Part du capital détenue', percent(inputs.shareBp)],
          ['Part du bénéfice distribuable versée', percent(inputs.distributionBp)],
          ['Parts du foyer fiscal', inputs.householdParts.toLocaleString('fr-FR')],
          ['Autres revenus imposables du foyer', money(inputs.otherIncomeCents)],
          ['Capital social, réserve légale, pertes antérieures', `${money(inputs.capitalCents)} ; ${money(inputs.legalReserveCents)} ; ${money(inputs.priorLossesCents)}`],
        ].map(([label, value]) => (
          <View key={label} style={styles.row} wrap={false}>
            <Text style={styles.label}>{label}</Text>
            <Text style={{ width: 200, textAlign: 'right' }}>{value}</Text>
          </View>
        ))}

        <Text style={styles.section}>Scénarios</Text>
        <View style={styles.headRow} fixed>
          <Text style={styles.label}> </Text>
          {SCENARIO_ORDER.map((id) => (
            <Text key={id} style={styles.amount}>
              {sim.scenarios[id].label}
            </Text>
          ))}
        </View>
        <View style={styles.row} wrap={false}>
          <Text style={styles.label}>Part du résultat en rémunération</Text>
          {SCENARIO_ORDER.map((id) => (
            <Text key={id} style={styles.amount}>
              {percent(sim.scenarios[id].remunerationShareBp)}
            </Text>
          ))}
        </View>
        {rows.map((r) => (
          <View key={r.id} style={r.strong ? styles.strong : styles.row} wrap={false}>
            <Text style={styles.label}>{r.label}</Text>
            {SCENARIO_ORDER.map((id) => (
              <Text key={id} style={styles.amount}>
                {money(r.values[id])}
              </Text>
            ))}
          </View>
        ))}
        <View style={styles.row} wrap={false}>
          <Text style={styles.label}>Imposition des dividendes</Text>
          {SCENARIO_ORDER.map((id) => (
            <Text key={id} style={styles.amount}>
              {sim.scenarios[id].dividends.receivedCents > 0 ? (sim.scenarios[id].dividends.taxation === 'pfu' ? 'PFU' : 'Barème') : ''}
            </Text>
          ))}
        </View>
        <Text style={styles.item}>PFU&nbsp;: {TAXATION_LABELS.pfu}. Barème&nbsp;: {TAXATION_LABELS.bareme}.</Text>

        {[...view.checks, ...sim.notes].length > 0 ? <Text style={styles.section}>À savoir</Text> : null}
        {[...view.checks, ...sim.notes].map((text) => (
          <Text key={text} style={styles.item}>
            - {text}
          </Text>
        ))}

        <Text style={styles.section}>Sources</Text>
        {view.sources.map((source) => (
          <Text key={source.label} style={styles.item}>
            {source.label}&nbsp;: {source.url}
          </Text>
        ))}
      </Page>
    </Document>
  )
}
