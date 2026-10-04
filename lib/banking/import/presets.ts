/**
 * CSV presets for banks whose export layout is documented publicly. A preset
 * is recognized by its header signature (normalized header names that must
 * all be present) and fixes the column roles, date layout and decimal
 * separator. Each preset cites where its layout comes from (official help
 * pages when they exist, otherwise open-source importers that hardcode the
 * real export header). Banks without a verifiable source (LCL today) rely on
 * the generic automapping in tabular.ts, which also covers layout variants.
 */

import type { ColumnMapping, ColumnRole, DateFormat, DecimalSeparator } from './types'

export interface BankPreset {
  id: string
  name: string
  /** Where the layout comes from. */
  source: string
  /** Normalized header names (see normalizeHeader) that must all be present. */
  signature: string[]
  /** Normalized header name for each role (the first present one when several). */
  columns: Partial<Record<ColumnRole, string | string[]>>
  dateFormat?: DateFormat
  decimalSeparator?: DecimalSeparator
}

export const BANK_PRESETS: BankPreset[] = [
  {
    // Header "Date operation;Libelle court;Type operation;Libelle operation;Montant operation en euro",
    // below one account line and a blank line. Sources (open-source importers):
    // https://github.com/BrunBrun24/InsightBank/blob/HEAD/src/accounts/bank/importers/data_extractor.py
    // https://github.com/Corsud/Tresoperso/blob/HEAD/tests/test_parse_csv.py
    id: 'bnp-paribas',
    name: 'BNP Paribas',
    source: 'https://github.com/BrunBrun24/InsightBank/blob/HEAD/src/accounts/bank/importers/data_extractor.py',
    signature: ['date operation', 'libelle operation', 'montant operation en euro'],
    columns: { date: 'date operation', label: 'libelle operation', amount: 'montant operation en euro' },
    dateFormat: 'dd/mm/yyyy',
    decimalSeparator: ',',
  },
  {
    // Header "Date de l'opération;Libellé;Détail de l'écriture;Montant de l'opération;Devise",
    // below an account line and a blank line. Sources:
    // https://github.com/AiroPi/moneymanager/blob/HEAD/readers/societe_generale.py
    // https://github.com/crycriM/hermes-skills/blob/HEAD/productivity/bank-statement-extraction/references/societe-generale-releve.md
    id: 'societe-generale',
    name: 'Société Générale',
    source: 'https://github.com/AiroPi/moneymanager/blob/HEAD/readers/societe_generale.py',
    signature: ['date de l operation', 'libelle', 'detail de l ecriture', 'montant de l operation'],
    columns: {
      date: 'date de l operation',
      label: 'libelle',
      label2: 'detail de l ecriture',
      amount: 'montant de l operation',
      currency: 'devise',
    },
    dateFormat: 'dd/mm/yyyy',
    decimalSeparator: ',',
  },
  {
    // Header "Date;Libellé;Débit Euros;Crédit Euros;" below about nine lines of
    // account information; debit and credit both positive. Source:
    // https://github.com/jbleduigou/budgetcategorizer/blob/HEAD/parser/parser_test.go
    id: 'credit-agricole',
    name: 'Crédit Agricole',
    source: 'https://github.com/jbleduigou/budgetcategorizer/blob/HEAD/parser/parser_test.go',
    signature: ['date', 'libelle', 'debit euros', 'credit euros'],
    columns: { date: 'date', valueDate: 'date valeur', label: 'libelle', debit: 'debit euros', credit: 'credit euros' },
    dateFormat: 'dd/mm/yyyy',
    decimalSeparator: ',',
  },
  {
    // Header "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;
    // Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;
    // Date operation;Date de valeur;Pointage operation". Sources:
    // https://github.com/NonoHM/budgetpilot/blob/HEAD/src/lib/server/import/profiles/banque-populaire.ts
    // https://github.com/Djoulzy/compta/blob/HEAD/README.md
    id: 'bpce',
    name: "Banque Populaire / Caisse d'Epargne",
    source: 'https://github.com/NonoHM/budgetpilot/blob/HEAD/src/lib/server/import/profiles/banque-populaire.ts',
    signature: ['date de comptabilisation', 'libelle operation', 'debit', 'credit', 'date de valeur'],
    columns: {
      date: 'date de comptabilisation',
      valueDate: 'date de valeur',
      label: 'libelle operation',
      label2: 'informations complementaires',
      reference: 'reference',
      debit: 'debit',
      credit: 'credit',
    },
    dateFormat: 'dd/mm/yyyy',
    decimalSeparator: ',',
  },
  {
    // Header "Date;Date de valeur;Débit;Crédit;Libellé;Solde" (ISO-8859-15, debit
    // written negative). Sources:
    // https://github.com/afup/web/blob/HEAD/sources/AppBundle/Compta/Importer/CreditMutuel.php
    // https://github.com/vrischmann/beancount-importers/blob/HEAD/synthetic/ccm-courant/README.md
    id: 'credit-mutuel-cic',
    name: 'Crédit Mutuel / CIC',
    source: 'https://github.com/afup/web/blob/HEAD/sources/AppBundle/Compta/Importer/CreditMutuel.php',
    signature: ['date', 'date de valeur', 'debit', 'credit', 'libelle', 'solde'],
    columns: { date: 'date', valueDate: 'date de valeur', debit: 'debit', credit: 'credit', label: 'libelle' },
    dateFormat: 'dd/mm/yyyy',
    decimalSeparator: ',',
  },
  {
    // Single amount variant of the same export: "Date;Date de valeur;Montant;Libellé;Solde".
    // Source: https://github.com/vrischmann/beancount-importers/blob/HEAD/synthetic/ccm-courant/README.md
    id: 'credit-mutuel-cic-montant',
    name: 'Crédit Mutuel / CIC (montant unique)',
    source: 'https://github.com/vrischmann/beancount-importers/blob/HEAD/synthetic/ccm-courant/README.md',
    signature: ['date', 'date de valeur', 'montant', 'libelle', 'solde'],
    columns: { date: 'date', valueDate: 'date de valeur', amount: 'montant', label: 'libelle' },
    dateFormat: 'dd/mm/yyyy',
    decimalSeparator: ',',
  },
  {
    // Header "Date;Libellé;Montant(EUROS)" (older files add ";Montant(FRANCS)")
    // below five or six account lines and a blank line. Sources:
    // https://doc4-fr.openflyers.com/Mod%C3%A8le-d'import-de-relev%C3%A9-bancaire-CSV-Banque-Postale-avec-point-virgule
    // https://github.com/Fab2bprog/Rust-Radinus/blob/HEAD/radinus-core/src/csv_statement.rs
    id: 'la-banque-postale',
    name: 'La Banque Postale',
    source: "https://doc4-fr.openflyers.com/Mod%C3%A8le-d'import-de-relev%C3%A9-bancaire-CSV-Banque-Postale-avec-point-virgule",
    signature: ['date', 'libelle', 'montant euros'],
    columns: { date: 'date', label: 'libelle', amount: 'montant euros' },
    dateFormat: 'dd/mm/yyyy',
    decimalSeparator: ',',
  },
  {
    // Header "dateOp;dateVal;label;category;categoryParent;supplierFound;amount;comment;
    // accountNum;accountLabel;accountbalance" (older files lack supplierFound or comment),
    // ISO dates, amounts "1 718,70". Sources:
    // https://github.com/azerpas/bourso-api/blob/HEAD/src/bourso_api/src/client/transaction.rs
    // https://github.com/AiroPi/moneymanager/blob/HEAD/readers/boursobank.py
    id: 'boursobank',
    name: 'BoursoBank',
    source: 'https://github.com/azerpas/bourso-api/blob/HEAD/src/bourso_api/src/client/transaction.rs',
    signature: ['dateop', 'dateval', 'label', 'amount'],
    columns: { date: 'dateop', valueDate: 'dateval', label: 'label', label2: 'comment', counterparty: 'supplierfound', amount: 'amount' },
    dateFormat: 'yyyy-mm-dd',
    decimalSeparator: ',',
  },
  {
    // Header "Transaction ID;Date de la valeur;Date d'opération;IBAN;Type de transaction;
    // Transaction personnelle;Category;Débit;Crédit;Solde mouvement;Solde bancaire;Libellé;
    // Nom de la contrepartie;Montant HT;Montant de TVA total;Pièces;Date d'ajout pièces;Commentaire".
    // Sources: https://github.com/rodulfo-dmgz/RD-Recueil/blob/HEAD/app/js/engine/import-shine.js
    // https://github.com/babao60/ComptaTVA-Auto/blob/HEAD/types.ts
    id: 'shine',
    name: 'Shine',
    source: 'https://github.com/rodulfo-dmgz/RD-Recueil/blob/HEAD/app/js/engine/import-shine.js',
    signature: ['transaction id', 'date d operation', 'debit', 'credit', 'libelle', 'nom de la contrepartie'],
    columns: {
      transactionId: 'transaction id',
      date: 'date d operation',
      valueDate: 'date de la valeur',
      label: 'libelle',
      label2: 'commentaire',
      counterparty: 'nom de la contrepartie',
      debit: 'debit',
      credit: 'credit',
    },
    dateFormat: 'dd/mm/yyyy',
    decimalSeparator: ',',
  },
  {
    // English export. Field names from Qonto's own FAQ (Status processing/settled,
    // Transaction ID, Settlement date, Counterparty name, Total amount (incl. VAT)...):
    // https://github.com/qonto/qonto-faq-benchmark/blob/HEAD/dataset/documents/markdown/0764.md
    // Comma separated, "YYYY-MM-DD HH:MM:SS" dates and signed amounts per
    // https://github.com/enobase/demo-coda-export/blob/HEAD/src/parsers/qonto.ts
    id: 'qonto',
    name: 'Qonto',
    source: 'https://github.com/qonto/qonto-faq-benchmark/blob/HEAD/dataset/documents/markdown/0764.md',
    signature: ['transaction id', 'total amount incl vat'],
    columns: {
      transactionId: 'transaction id',
      status: 'status',
      date: ['settlement date local', 'settlement date utc', 'operation date local', 'operation date utc'],
      label: 'counterparty name',
      label2: 'note',
      counterparty: 'counterparty name',
      reference: 'reference',
      amount: 'total amount incl vat',
      currency: 'currency',
    },
    dateFormat: 'yyyy-mm-dd',
    decimalSeparator: '.',
  },
  {
    // French export: "Statut;Date de la valeur (UTC);Date de l'opération (UTC);Montant total (TTC);
    // Débit;Crédit;Solde;Devise;Nom de la contrepartie;...;Identifiant de transaction;Référence"
    // with "DD-MM-YYYY HH:MM:SS" dates. Source:
    // https://github.com/enobase/demo-coda-export/blob/HEAD/src/parsers/qonto.ts
    id: 'qonto-fr',
    name: 'Qonto (export en français)',
    source: 'https://github.com/enobase/demo-coda-export/blob/HEAD/src/parsers/qonto.ts',
    signature: ['identifiant de transaction', 'montant total ttc'],
    columns: {
      transactionId: 'identifiant de transaction',
      status: 'statut',
      date: ['date de reglement local', 'date de reglement utc', 'date de la valeur utc', 'date de l operation utc'],
      label: 'nom de la contrepartie',
      counterparty: 'nom de la contrepartie',
      reference: 'reference',
      amount: 'montant total ttc',
      currency: 'devise',
    },
    dateFormat: 'dd/mm/yyyy',
    decimalSeparator: ',',
  },
  {
    // Header "Date started (UTC),Date completed (UTC),ID,Type,State,Description,Reference,Payer,
    // Card number,...,Payment currency,Amount,Total amount,Exchange rate,Fee,...,Balance,...",
    // comma separated, dot decimal, signed amounts. "Total amount" (amount and fee) only
    // exists in recent exports; older ones fall back to "Amount". Sources:
    // https://github.com/BananaAccounting/Universal/blob/HEAD/extensions/import/revolut/ch.banana.uni.import.revolut.js
    // https://github.com/joaointech/accountability/blob/HEAD/revolut_bank_extract.csv
    id: 'revolut-business',
    name: 'Revolut Business',
    source: 'https://github.com/BananaAccounting/Universal/blob/HEAD/extensions/import/revolut/ch.banana.uni.import.revolut.js',
    signature: ['date completed utc', 'id', 'description', 'amount', 'payment currency'],
    columns: {
      date: 'date completed utc',
      transactionId: 'id',
      status: 'state',
      label: 'description',
      reference: 'reference',
      counterparty: 'payer',
      amount: ['total amount', 'amount'],
      currency: 'payment currency',
    },
    dateFormat: 'yyyy-mm-dd',
    decimalSeparator: '.',
  },
]

/**
 * Preset whose signature matches the (normalized) headers. With `id`, only
 * that preset is considered (and returned even when its signature does not
 * match, so the user can force it).
 */
export function findPreset(normalizedHeaders: string[], id?: string): BankPreset | undefined {
  if (id !== undefined) return BANK_PRESETS.find((p) => p.id === id)
  const set = new Set(normalizedHeaders)
  // Most specific signature first (BPCE before Crédit Mutuel...)
  return [...BANK_PRESETS]
    .sort((a, b) => b.signature.length - a.signature.length)
    .find((p) => p.signature.every((h) => set.has(h)))
}

export function resolvePresetMapping(preset: BankPreset, normalizedHeaders: string[]): ColumnMapping {
  const mapping: ColumnMapping = {}
  for (const [role, header] of Object.entries(preset.columns)) {
    for (const name of Array.isArray(header) ? header : [header!]) {
      const index = normalizedHeaders.indexOf(name)
      if (index >= 0) {
        mapping[role as ColumnRole] = index
        break
      }
    }
  }
  return mapping
}
