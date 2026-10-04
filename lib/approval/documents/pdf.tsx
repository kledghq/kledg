/**
 * PDF rendering of a generated document (@react-pdf/renderer, as the
 * statements in lib/pdf): A4, Helvetica, black on white, a footer with the
 * page number on every page. Same content as the Markdown (model.ts).
 */

import React from 'react'
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { Block, GeneratedDocument } from './model'

const styles = StyleSheet.create({
  page: { paddingTop: 42, paddingBottom: 56, paddingHorizontal: 52, fontSize: 10, fontFamily: 'Helvetica', lineHeight: 1.45, color: '#000' },
  header: { marginBottom: 18, paddingBottom: 8, borderBottom: '0.75 solid #000' },
  company: { fontSize: 12, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  headerLine: { fontSize: 8.5 },
  title: { fontSize: 13, fontFamily: 'Helvetica-Bold', textAlign: 'center', marginTop: 4, marginBottom: 4, textTransform: 'uppercase' },
  subtitle: { fontSize: 9.5, textAlign: 'center', marginBottom: 16 },
  heading: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', marginTop: 12, marginBottom: 4 },
  paragraph: { marginBottom: 7, textAlign: 'justify' },
  note: { marginTop: 6, marginBottom: 7, fontSize: 8.5, color: '#333' },
  listItem: { flexDirection: 'row', marginBottom: 3, paddingLeft: 10 },
  bullet: { width: 12 },
  listText: { flex: 1 },
  table: { marginTop: 4, marginBottom: 10, borderTop: '0.5 solid #000', borderLeft: '0.5 solid #000' },
  row: { flexDirection: 'row' },
  cell: { flex: 1, padding: 4, borderRight: '0.5 solid #000', borderBottom: '0.5 solid #000', fontSize: 9 },
  headCell: { fontFamily: 'Helvetica-Bold' },
  numeric: { textAlign: 'right' },
  signatures: { marginTop: 18, flexDirection: 'row', flexWrap: 'wrap' },
  signer: { width: '50%', paddingRight: 12, marginBottom: 46 },
  footer: { position: 'absolute', bottom: 24, left: 52, right: 52, fontSize: 7.5, color: '#444', flexDirection: 'row', justifyContent: 'space-between' },
})

/** Helvetica in react-pdf encodes WinAnsi: the narrow no-break space has no glyph there. */
const pdfText = (text: string) => text.replace(/ /g, ' ')

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case 'heading':
      return <Text style={styles.heading}>{pdfText(block.text)}</Text>
    case 'paragraph':
      return <Text style={styles.paragraph}>{pdfText(block.text)}</Text>
    case 'note':
      return <Text style={styles.note}>{pdfText(block.text)}</Text>
    case 'list':
    case 'checklist':
      return (
        <View>
          {block.items.map((item, i) => (
            <View key={i} style={styles.listItem} wrap={false}>
              <Text style={styles.bullet}>{block.kind === 'checklist' ? '[  ]' : '-'}</Text>
              <Text style={styles.listText}>{pdfText(item)}</Text>
            </View>
          ))}
        </View>
      )
    case 'table':
      return (
        <View style={styles.table}>
          <View style={styles.row} fixed>
            {block.columns.map((c, i) => (
              <Text key={i} style={[styles.cell, styles.headCell, block.numeric?.includes(i) ? styles.numeric : {}]}>
                {pdfText(c)}
              </Text>
            ))}
          </View>
          {block.rows.map((r, ri) => (
            <View key={ri} style={styles.row} wrap={false}>
              {r.map((c, i) => (
                <Text key={i} style={[styles.cell, block.numeric?.includes(i) ? styles.numeric : {}]}>
                  {pdfText(c)}
                </Text>
              ))}
            </View>
          ))}
        </View>
      )
    case 'signatures':
      return (
        <View wrap={false}>
          {block.place || block.date ? (
            <Text style={styles.paragraph}>{pdfText(`Fait${block.place ? ` à ${block.place}` : ''}${block.date ? `, le ${block.date}` : ''}`)}</Text>
          ) : null}
          <View style={styles.signatures}>
            {block.signers.map((s, i) => (
              <View key={i} style={styles.signer}>
                <Text>{pdfText(s.name)}</Text>
                <Text style={styles.headerLine}>{pdfText(s.role)}</Text>
              </View>
            ))}
          </View>
        </View>
      )
  }
}

export function ApprovalDocumentPdf({ doc }: { doc: GeneratedDocument }) {
  return (
    <Document title={doc.title} author={doc.header[0]} creator="Kledg" producer="Kledg">
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          {doc.header.map((line, i) => (
            <Text key={i} style={i === 0 ? styles.company : styles.headerLine}>
              {pdfText(line)}
            </Text>
          ))}
        </View>
        <Text style={styles.title}>{pdfText(doc.title)}</Text>
        {doc.subtitle ? <Text style={styles.subtitle}>{pdfText(doc.subtitle)}</Text> : null}
        {doc.blocks.map((block, i) => (
          <BlockView key={i} block={block} />
        ))}
        <View style={styles.footer} fixed>
          <Text>{pdfText(doc.footer)}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
