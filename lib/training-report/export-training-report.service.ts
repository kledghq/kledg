/**
 * The bilan pédagogique et financier of a fiscal year as a CSV file that
 * mirrors the frames of cerfa 10443*17 (B to G), to copy into Mon Activité
 * Formation: the same figures, checks and sources as the page. Cells go
 * through lib/reports/csv-safe (formula injection, separators), with a byte
 * order mark so Excel reads UTF-8. A worksheet, never the official form:
 * the organisation files on Mon Activité Formation.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import type { GeneratedFile } from '@/lib/api/download'
import { buildCsv } from '@/lib/reports/csv-safe'
import { fileNamePart } from '@/lib/reports/export-reports.service'
import { loadTrainingReport, TrainingReportQuerySchema, type TrainingReportView } from './load-training-report.service'
import type { CountHours } from './schemas'

export const TrainingReportExportQuerySchema = TrainingReportQuerySchema.extend({
  format: z.enum(['csv'], { error: 'Format d’export inconnu : csv' }).default('csv'),
})
export type TrainingReportExportQuery = z.infer<typeof TrainingReportExportQuerySchema>

type Row = Array<string | number | null>
const pair = (label: string, value: CountHours, code = ''): Row => [code, label, value.count, value.hours]

function trainingReportCsv(view: TrainingReportView, companyName: string): string {
  const { data, frameC: c, frameD: d, fiscalYear } = view
  const rows: Row[] = [
    ['Bilan pédagogique et financier (cerfa 10443*17)', companyName],
    ['Document de travail à recopier sur Mon Activité Formation, pas le formulaire officiel'],
    [],
    ['A. Identification'],
    ...view.establishments.map((e): Row => ['', e.name ?? 'Établissement', `SIRET ${e.siret}`, e.declarationNumber ? `Déclaration ${e.declarationNumber}` : 'Numéro de déclaration à saisir']),
    [],
    ['B. Informations générales'],
    ['', 'Exercice comptable du', fiscalYear?.startDate ?? '', fiscalYear?.endDate ?? ''],
    ['', 'Formation en tout ou partie à distance', data.distanceLearning === null ? 'À préciser' : data.distanceLearning ? 'Oui' : 'Non'],
    [],
    ['C. Bilan financier hors taxes : origine des produits (euros)'],
  ]
  if (c) {
    for (const line of c.lines) {
      rows.push([line.line, line.label, line.euros])
      if (line.code === 'c2h') rows.push(['2', 'Total des produits provenant des organismes gestionnaires des fonds de la formation (lignes a à h)', c.opcoTotalEuros])
    }
    rows.push(['', 'Total des produits réalisés au titre de la formation professionnelle (lignes 1 à 11)', c.totalEuros])
    rows.push(['', 'Part du chiffre d’affaires global réalisée dans le domaine de la formation professionnelle (%)', c.sharePercent ?? ''])
    if (c.unassignedCents !== 0) rows.push(['', 'Recettes sans origine, à affecter avant de déposer', Math.round(c.unassignedCents / 100)])
  }
  rows.push([], ['D. Bilan financier hors taxes : charges (euros)'])
  if (d) {
    const src = (s: 'books' | 'entered') => (s === 'books' ? 'D’après les comptes' : 'Saisi')
    rows.push(
      ['', 'Total des charges de l’organisme liées à l’activité de formation', d.total.euros, src(d.total.source)],
      ['', 'dont salaires des formateurs', d.trainerSalaries.euros, src(d.trainerSalaries.source)],
      ['', 'dont achats de prestation de formation et honoraires de formation', d.trainingPurchases.euros, src(d.trainingPurchases.source)],
    )
  }
  rows.push(
    [],
    ['E. Personnes dispensant des heures de formation', '', 'Nombre', 'Heures'],
    pair('Personnes de votre organisme', data.trainers.internal),
    pair('Personnes extérieures (sous-traitance)', data.trainers.external),
    [],
    ['F-1. Type de stagiaires', '', 'Nombre', 'Heures'],
    pair('Salariés d’employeurs privés hors apprentis', data.trainees.employees, 'a'),
    pair('Apprentis', data.trainees.apprentices, 'b'),
    pair('Personnes en recherche d’emploi', data.trainees.jobSeekers, 'c'),
    pair('Particuliers à leurs propres frais', data.trainees.individuals, 'd'),
    pair('Autres stagiaires', data.trainees.others, 'e'),
    pair('Total (a + b + c + d + e)', view.totals.trainees, '1'),
    [],
    ['F-2. Dont activité sous-traitée', '', 'Nombre', 'Heures'],
    pair('Stagiaires ou apprentis dont l’action a été confiée à un autre organisme', data.subcontracted, '2'),
    [],
    ['F-3. Objectif général des prestations', '', 'Nombre', 'Heures'],
    pair('Formations visant un diplôme, un titre ou un CQP enregistré au RNCP', data.objectives.rncp, 'a'),
    pair('dont de niveau 6 à 8', data.objectives.rncpLevel6to8),
    pair('dont de niveau 5', data.objectives.rncpLevel5),
    pair('dont de niveau 4', data.objectives.rncpLevel4),
    pair('dont de niveau 3', data.objectives.rncpLevel3),
    pair('dont de niveau 2', data.objectives.rncpLevel2),
    pair('dont CQP sans niveau de qualification', data.objectives.rncpCqpWithoutLevel),
    pair('Formations visant une certification ou une habilitation enregistrée au répertoire spécifique (RS)', data.objectives.rs, 'b'),
    pair('Formations visant un CQP non enregistré au RNCP ou au RS', data.objectives.cqpNotRegistered, 'c'),
    pair('Autres formations professionnelles', data.objectives.other, 'd'),
    pair('Bilans de compétence', data.objectives.skillsAssessment, 'e'),
    pair('Actions d’accompagnement à la validation des acquis de l’expérience', data.objectives.vae, 'f'),
    pair('Total (a + b + c + d + e + f)', view.totals.objectives, '3'),
    [],
    ['F-4. Spécialités de formation', 'Code', 'Nombre', 'Heures'],
    ...data.specialities.map((s): Row => [s.label, s.code, s.count, s.hours]),
    ['Autres spécialités', '', data.otherSpecialities.count, data.otherSpecialities.hours],
    ['Total', '4', view.totals.specialities.count, view.totals.specialities.hours],
    [],
    ['G. Stagiaires confiés par un autre organisme de formation', '', 'Nombre', 'Heures'],
    pair('Formations confiées à votre organisme par un autre organisme de formation', data.entrusted, '5'),
    [],
    ['Contrôles'],
    ...(view.checks.length ? view.checks.map((check): Row => ['', check]) : [['', 'Aucune incohérence']]),
    [],
    ['Échéance', view.deadline ? `Avant le 30 avril : ${view.deadline.date}` : '', view.deadline?.extendedDate ? `Campagne prolongée jusqu’au ${view.deadline.extendedDate}` : ''],
    [],
    ['Sources'],
    ...view.sources.map((s): Row => [s.label, s.url]),
  )
  return buildCsv(rows)
}

export async function exportTrainingReport(companyId: string, query: TrainingReportExportQuery, options: { now?: Date } = {}): Promise<GeneratedFile> {
  const [view, company] = await Promise.all([loadTrainingReport(companyId, query, options), prisma.company.findUnique({ where: { id: companyId }, select: { name: true } })])
  const companyName = company?.name ?? ''
  const label = view.fiscalYear ? view.fiscalYear.endDate.slice(0, 4) : 'sans_exercice'
  return { content: `﻿${trainingReportCsv(view, companyName)}`, fileName: `BPF_${label}_${fileNamePart(companyName)}.csv`, contentType: 'text/csv; charset=utf-8' }
}
