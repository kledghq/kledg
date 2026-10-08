/**
 * Income Statement PDF Template
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
import type { IncomeStatementPDFData } from '../generate-income-statement-pdf-data.service'
import type { IncomeStatementLine } from '@/lib/reports/income-statement/types'
import { formatAmount as formatAmountUtil } from '../utils'

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
  netResultBox: {
    marginTop: 8,
    padding: 6,
    borderTop: '1 solid #000',
    borderBottom: '1 solid #000',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  intermediateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
    paddingHorizontal: 4,
    borderBottom: '1 solid #d0d0d0',
  },
})

function formatAmount(amount: number): string {
  return formatAmountUtil(amount)
}

function renderLine(
  line: IncomeStatementLine,
  level: number = 0
): React.ReactElement {
  const indent = level * 15
  const isTotal = line.lineLabel.toLowerCase().includes('total')
  const isSection = line.children && line.children.length > 0

  return (
    <View key={line.id}>
      <View
        style={[
          styles.tableRow,
          ...(isTotal ? [styles.totalRow] : []),
          ...(isSection && !isTotal ? [styles.sectionHeader] : []),
        ]}
      >
        <View style={[styles.tableCellLabel, { paddingLeft: indent + 5 }]}>
          {!line.hideLabel && (
            <Text style={isTotal ? { fontWeight: 'bold' } : {}}>
              {line.formCode ? `[${line.formCode}] ` : ''}
              {line.lineLabel}
            </Text>
          )}
        </View>
        <View style={styles.tableCellValue}>
          <Text style={isTotal ? { fontWeight: 'bold' } : {}}>
            {formatAmount(line.value)}
          </Text>
        </View>
      </View>
      {line.children && line.children.map((child) => renderLine(child, level + 1))}
    </View>
  )
}

interface IncomeStatementPDFProps extends IncomeStatementPDFData {}

export function IncomeStatementPDF({
  company,
  fiscalYear,
  incomeStatement,
}: IncomeStatementPDFProps) {
  const isSimplified = incomeStatement.reportVariant === 'simplified'
  const startDateStr = fiscalYear.startDate.toLocaleDateString('fr-FR')
  const endDateStr = fiscalYear.endDate.toLocaleDateString('fr-FR')
  const intermediate = incomeStatement.intermediateResults

  return (
    <Document>
      <Page size="A4" style={styles.page}>
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

        <Text style={styles.title}>
          {isSimplified ? 'COMPTE DE RÉSULTAT SIMPLIFIÉ' : 'COMPTE DE RÉSULTAT'}
        </Text>

        <View style={styles.twoColumns}>
          {/* PRODUITS */}
          <View style={styles.column}>
            <Text style={styles.subtitle}>PRODUITS</Text>
            <View style={styles.tableHeader}>
              <View style={[styles.tableHeaderCell, { flex: 2.5 }]}>
                <Text>Libellé</Text>
              </View>
              <View style={styles.tableHeaderCell}>
                <Text>Montant</Text>
              </View>
            </View>
            <View style={styles.table}>
              {incomeStatement.produits.lines.map((line) => renderLine(line, 0))}
            </View>
            <View style={styles.totalRow}>
              <View style={[styles.tableCellLabel, { flex: 2.5 }]}>
                <Text style={{ fontWeight: 'bold' }}>TOTAL PRODUITS</Text>
              </View>
              <View style={styles.tableCellValue}>
                <Text style={{ fontWeight: 'bold' }}>
                  {formatAmount(incomeStatement.totalProduits)}
                </Text>
              </View>
            </View>
          </View>

          {/* CHARGES */}
          <View style={styles.column}>
            <Text style={styles.subtitle}>CHARGES</Text>
            <View style={styles.tableHeader}>
              <View style={[styles.tableHeaderCell, { flex: 2.5 }]}>
                <Text>Libellé</Text>
              </View>
              <View style={styles.tableHeaderCell}>
                <Text>Montant</Text>
              </View>
            </View>
            <View style={styles.table}>
              {incomeStatement.charges.lines.map((line) => renderLine(line, 0))}
            </View>
            <View style={styles.totalRow}>
              <View style={[styles.tableCellLabel, { flex: 2.5 }]}>
                <Text style={{ fontWeight: 'bold' }}>TOTAL CHARGES</Text>
              </View>
              <View style={styles.tableCellValue}>
                <Text style={{ fontWeight: 'bold' }}>
                  {formatAmount(incomeStatement.totalCharges)}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Intermediate results */}
        {intermediate && (
          <View style={{ marginTop: 8 }}>
            <Text style={styles.subtitle}>Soldes intermédiaires</Text>
            {intermediate.resultatExploitation !== undefined && (
              <View style={styles.intermediateRow}>
                <Text>Résultat d&apos;exploitation</Text>
                <Text>{formatAmount(intermediate.resultatExploitation)}</Text>
              </View>
            )}
            {intermediate.resultatFinancier !== undefined && (
              <View style={styles.intermediateRow}>
                <Text>Résultat financier</Text>
                <Text>{formatAmount(intermediate.resultatFinancier)}</Text>
              </View>
            )}
            {intermediate.resultatCourant !== undefined && (
              <View style={styles.intermediateRow}>
                <Text>Résultat courant avant impôts</Text>
                <Text>{formatAmount(intermediate.resultatCourant)}</Text>
              </View>
            )}
            {intermediate.resultatExceptionnel !== undefined && (
              <View style={styles.intermediateRow}>
                <Text>Résultat exceptionnel</Text>
                <Text>{formatAmount(intermediate.resultatExceptionnel)}</Text>
              </View>
            )}
          </View>
        )}

        {/* Net result */}
        <View style={styles.netResultBox}>
          <Text style={{ fontWeight: 'bold', fontSize: 10 }}>RÉSULTAT NET</Text>
          <Text style={{ fontWeight: 'bold', fontSize: 10 }}>
            {formatAmount(incomeStatement.netResult)}
          </Text>
        </View>

        {/* Validation warning */}
        {incomeStatement.validation && !incomeStatement.validation.matches && (
          <View
            style={{
              marginTop: 6,
              paddingVertical: 3,
              paddingHorizontal: 4,
              borderTop: '1 solid #000',
              borderBottom: '1 solid #000',
            }}
          >
            <Text style={{ fontSize: 7.5, color: '#000', fontWeight: 'bold' }}>
              ATTENTION&nbsp;: écart avec le bilan (compte 12) de{' '}
              {formatAmount(incomeStatement.validation.difference || 0)}
            </Text>
          </View>
        )}
      </Page>
    </Document>
  )
}
