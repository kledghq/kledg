/**
 * Balance Sheet PDF Template
 * Matches official form structure (2033-sd_5015.jpg for simplified)
 */

import { safeLogoSrc } from '@/lib/companies/logo'
import React from 'react'
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
} from '@react-pdf/renderer'
import type { BalanceSheetPDFData } from '../generate-balance-sheet-pdf-data.service'
import type { BalanceSheetLine } from '@/lib/reports/balance-sheet/types'

const styles = StyleSheet.create({
  page: {
    padding: 18,
    fontSize: 9,
    fontFamily: 'Helvetica',
    backgroundColor: '#ffffff',
  },
  header: {
    marginBottom: 8,
    borderBottom: '1 solid #000',
    paddingBottom: 4,
  },
  companyName: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 2,
    color: '#000',
  },
  companyInfo: {
    fontSize: 7.5,
    color: '#000',
    marginTop: 1,
  },
  title: {
    fontSize: 11,
    fontWeight: 'bold',
    marginTop: 6,
    marginBottom: 4,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 9,
    fontWeight: 'bold',
    marginTop: 4,
    marginBottom: 2,
  },
  twoColumns: {
    flexDirection: 'row',
    marginTop: 6,
  },
  column: {
    flex: 1,
    marginHorizontal: 4,
  },
  table: {
    display: 'flex',
    flexDirection: 'column',
    marginTop: 2,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottom: '1 solid #d0d0d0',
    paddingVertical: 2,
    minHeight: 14,
    alignItems: 'flex-start',
  },
  tableCellLabel: {
    flex: 2.5,
    paddingHorizontal: 4,
    paddingVertical: 1,
    fontSize: 7.5,
    color: '#000',
    lineHeight: 1.2,
  },
  tableCellValue: {
    flex: 1,
    paddingHorizontal: 4,
    paddingVertical: 1,
    textAlign: 'right',
    fontSize: 7.5,
    fontFamily: 'Helvetica',
    color: '#000',
    lineHeight: 1.2,
  },
  tableCellValueBrut: {
    flex: 0.9,
    paddingHorizontal: 3,
    paddingVertical: 1,
    textAlign: 'right',
    fontSize: 7,
    fontFamily: 'Helvetica',
    color: '#000',
  },
  tableCellValueAmort: {
    flex: 0.9,
    paddingHorizontal: 3,
    paddingVertical: 1,
    textAlign: 'right',
    fontSize: 7,
    fontFamily: 'Helvetica',
    color: '#000',
  },
  tableCellValueNet: {
    flex: 0.9,
    paddingHorizontal: 3,
    paddingVertical: 1,
    textAlign: 'right',
    fontSize: 7,
    fontFamily: 'Helvetica',
    color: '#000',
    fontWeight: 'bold',
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottom: '1 solid #000',
    paddingVertical: 2,
    fontWeight: 'bold',
  },
  tableHeaderCell: {
    flex: 1,
    paddingHorizontal: 4,
    fontSize: 7,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  totalRow: {
    flexDirection: 'row',
    borderTop: '1 solid #000',
    borderBottom: '1 solid #000',
    paddingVertical: 3,
    fontWeight: 'bold',
  },
  sectionHeader: {
    flexDirection: 'row',
    paddingVertical: 2,
    fontWeight: 'bold',
    marginTop: 1,
  },
  negativeValue: {
    color: '#000',
  },
})

import { formatAmount as formatAmountUtil } from '../utils'

/**
 * Formats a number for display in PDF
 */
function formatAmount(amount: number): string {
  return formatAmountUtil(amount)
}

/**
 * Renders a balance sheet line recursively
 */
function renderBalanceSheetLine(
  line: BalanceSheetLine,
  level: number = 0,
  showBrutAmort: boolean = false
): React.ReactElement {
  const indent = level * 15
  const isTotal = line.lineLabel.toLowerCase().includes('total')
  const isSection = line.children && line.children.length > 0
  // Totals should not display brut/amortissement - they're just sums of children
  // Only non-total lines with accounts can have brut/amortissement
  const hasBrutAmort = !isTotal && showBrutAmort && (line.brut !== undefined || line.amortissements !== undefined)

  return (
      <View key={line.id}>
        <View style={[
          styles.tableRow,
          ...(isTotal ? [styles.totalRow] : []),
          ...(isSection ? [styles.sectionHeader] : []),
        ]}>
        <View style={[styles.tableCellLabel, { paddingLeft: indent + 5 }]}>
          {!line.hideLabel && (
            <Text style={isTotal ? { fontWeight: 'bold' } : {}}>
              {line.lineLabel}
            </Text>
          )}
        </View>
        {hasBrutAmort ? (
          <>
            <View style={styles.tableCellValueBrut}>
              <Text>{formatAmount(line.brut || 0)}</Text>
            </View>
            <View style={styles.tableCellValueAmort}>
              <Text>{formatAmount(line.amortissements || 0)}</Text>
            </View>
            <View style={styles.tableCellValueNet}>
              <Text style={isTotal ? { fontWeight: 'bold' } : {}}>
                {formatAmount(line.net)}
              </Text>
            </View>
          </>
        ) : (
          <View style={styles.tableCellValue}>
            <Text style={isTotal ? { fontWeight: 'bold' } : {}}>
              {formatAmount(line.net)}
            </Text>
          </View>
        )}
      </View>
      {line.children && line.children.map((child) =>
        renderBalanceSheetLine(child, level + 1, showBrutAmort)
      )}
    </View>
  )
}

interface BalanceSheetPDFProps extends BalanceSheetPDFData {}

export function BalanceSheetPDF({
  company,
  fiscalYear,
  balanceSheet,
}: BalanceSheetPDFProps) {
  const isSimplified = balanceSheet.reportVariant === 'simplified'
  const showBrutAmort = balanceSheet.actif.lines.some(
    (line) => line.brut !== undefined || line.amortissements !== undefined
  )

  // Format fiscal year dates
  const startDateStr = fiscalYear.startDate.toLocaleDateString('fr-FR')
  const endDateStr = fiscalYear.endDate.toLocaleDateString('fr-FR')

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 2 }}>
            {safeLogoSrc(company.logo) && (
              <Image
                src={safeLogoSrc(company.logo) as string}
                style={{ width: 36, height: 36, objectFit: 'contain' }}
              />
            )}
            <Text style={styles.companyName}>{company.name}</Text>
          </View>
          {company.address && (
            <Text style={styles.companyInfo}>{company.address}</Text>
          )}
          <Text style={styles.companyInfo}>SIREN&nbsp;: {company.siren}</Text>
          <Text style={styles.companyInfo}>
            Exercice du {startDateStr} au {endDateStr}
          </Text>
        </View>

        {/* Title */}
        <Text style={styles.title}>
          {isSimplified ? 'BILAN SIMPLIFIÉ' : 'BILAN'}
        </Text>

        {/* Two columns layout */}
        <View style={styles.twoColumns}>
          {/* ACTIF Column */}
          <View style={styles.column}>
            <Text style={styles.subtitle}>ACTIF</Text>
            {showBrutAmort && (
              <View style={styles.tableHeader}>
                <View style={[styles.tableHeaderCell, { flex: 2.5 }]}>
                  <Text>Libellé</Text>
                </View>
                <View style={styles.tableHeaderCell}>
                  <Text>Brut</Text>
                </View>
                <View style={styles.tableHeaderCell}>
                  <Text>Amort.</Text>
                </View>
                <View style={styles.tableHeaderCell}>
                  <Text>Net</Text>
                </View>
              </View>
            )}
            {!showBrutAmort && (
              <View style={styles.tableHeader}>
                <View style={[styles.tableHeaderCell, { flex: 2.5 }]}>
                  <Text>Libellé</Text>
                </View>
                <View style={styles.tableHeaderCell}>
                  <Text>Net</Text>
                </View>
              </View>
            )}
            <View style={styles.table}>
              {balanceSheet.actif.lines.map((line) =>
                renderBalanceSheetLine(line, 0, showBrutAmort)
              )}
            </View>
            <View style={styles.totalRow}>
              <View style={[styles.tableCellLabel, { flex: 2.5 }]}>
                <Text style={{ fontWeight: 'bold' }}>TOTAL ACTIF</Text>
              </View>
              {showBrutAmort ? (
                <>
                  <View style={styles.tableCellValueBrut}>
                    <Text style={{ fontWeight: 'bold' }}>
                      {formatAmount(balanceSheet.actif.brutTotal || 0)}
                    </Text>
                  </View>
                  <View style={styles.tableCellValueAmort}>
                    <Text style={{ fontWeight: 'bold' }}>
                      {formatAmount(balanceSheet.actif.amortissementsTotal || 0)}
                    </Text>
                  </View>
                  <View style={styles.tableCellValueNet}>
                    <Text style={{ fontWeight: 'bold' }}>
                      {formatAmount(balanceSheet.actifTotal)}
                    </Text>
                  </View>
                </>
              ) : (
                <View style={styles.tableCellValue}>
                  <Text style={{ fontWeight: 'bold' }}>
                    {formatAmount(balanceSheet.actifTotal)}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* PASSIF Column */}
          <View style={styles.column}>
            <Text style={styles.subtitle}>PASSIF</Text>
            <View style={styles.tableHeader}>
              <View style={[styles.tableHeaderCell, { flex: 2.5 }]}>
                <Text>Libellé</Text>
              </View>
              <View style={styles.tableHeaderCell}>
                <Text>Net</Text>
              </View>
            </View>
            <View style={styles.table}>
              {balanceSheet.passif.lines.map((line) =>
                renderBalanceSheetLine(line, 0, false)
              )}
            </View>
            <View style={styles.totalRow}>
              <View style={[styles.tableCellLabel, { flex: 2.5 }]}>
                <Text style={{ fontWeight: 'bold' }}>TOTAL PASSIF</Text>
              </View>
              <View style={styles.tableCellValue}>
                <Text style={{ fontWeight: 'bold' }}>
                  {formatAmount(balanceSheet.passifTotal)}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Imbalance warning - sober style */}
        {balanceSheet.imbalance && (
          <View style={{ marginTop: 6, paddingVertical: 3, paddingHorizontal: 4, borderTop: '1 solid #000', borderBottom: '1 solid #000' }}>
            <Text style={{ fontSize: 7.5, color: '#000', fontWeight: 'bold' }}>
              ATTENTION&nbsp;: le bilan n&apos;est pas équilibré, écart&nbsp;: {formatAmount(balanceSheet.imbalance)}
            </Text>
          </View>
        )}
      </Page>
    </Document>
  )
}
