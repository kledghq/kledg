# Échéances et suivi des déclarations

Le calendrier des échéances fiscales et juridiques d'une société, et le suivi
de ce qui a été déposé et payé. Page : États, Échéances
(`/<société>/echeances`), widget Échéances du tableau de bord
([tableau de bord](tableau-de-bord.md)), liste « À faire » de l'accueil du
mode simple ([mode simple](mode-simple.md)). Code : `lib/deadlines` (le
calendrier) et `lib/declarations` (le suivi).

## Le calendrier

`lib/deadlines/engine.ts` calcule, sans base de données ni horloge, les
échéances d'une période à partir des régimes de la société (et de leur
historique), de sa forme juridique, de ses exercices et des paramètres des
échéances (carte Échéances de la page Informations). Chaque échéance cite sa
règle et ses sources officielles (`lib/deadlines/rules.ts`) :

| Catégorie | Échéances | Sources |
| --- | --- | --- |
| TVA | CA3 mensuelle ou trimestrielle, CA12 et ses acomptes (réel simplifié supprimé en 2027) | CGI, art. 287 ; CGI, ann. IV, art. 39 ; BOI-TVA-DECLA-20-20-10-10 et 20-30-10 |
| IS | Acomptes 2571 et solde 2572 | CGI, art. 1668 ; BOI-IS-DECLA-20-10 |
| Liasse | Déclaration de résultat 2065 et liasse, DAS2 | CGI, art. 223 ; BOI-BIC-DECLA-30-70-20 |
| CFE | Acompte du 15 juin (d'après l'avis de l'année précédente quand il est saisi), solde du 15 décembre, déclaration initiale 1447-C-SD, déclaration modificative 1447-M-SD | CGI, art. 1477, 1478 et 1679 quinquies |
| CVAE | Déclaration 1330-CVAE, acomptes 1329-AC, liquidation 1329-DEF ; plus rien pour les années 2030 et suivantes (CVAE supprimée) | CGI, art. 1586 ter à 1586 nonies et 1679 septies ; loi n° 2025-127, art. 62 |
| Taxe sur les salaires | Relevés 2501 mensuels ou trimestriels (d'après la taxe de l'année précédente), déclaration annuelle 2502 au 15 janvier (31 janvier admis), pour les années où la taxe est due, d'après la page Taxe sur les salaires | CGI, art. 231 ; BOI-TPS-TS-40 ; notice 2501-SD |
| Formation | Bilan pédagogique et financier de chaque exercice d'un organisme de formation, avant le 30 avril de l'année qui suit sa clôture (prolongations annoncées : 31 mai 2026) | Code du travail, art. R6352-22 à R6352-24 |
| Juridique | Approbation des comptes, dépôt au greffe | Code de commerce, L223-26, L225-100, L227-9, L232-22, L232-23 |

Les dates sont reportées au jour ouvrable suivant quand l'administration le
fait ; un jour que Kledg ne connaît pas (celui de la CA3) est indicatif. Le
détail des impôts locaux est dans [impôts locaux](impots-locaux.md).

## Le suivi : à faire, déposée, payée, en retard

Chaque échéance porte un **statut** (`lib/declarations/status.ts`), calculé
à chaque lecture :

| Statut | Quand |
| --- | --- |
| À faire | Rien d'enregistré, la date n'est pas passée |
| Déposée | La déclaration est déposée (une déclaration sans paiement est alors terminée ; une déclaration avec paiement attend le paiement) |
| Payée | Le paiement est fait (avec le dépôt quand l'échéance demande les deux) |
| En retard | Rien de terminé après la date, ou après le délai de télédéclaration quand il existe (liasse, 1330-CVAE : 15 jours de plus) |
| Non due | Une échéance conditionnelle qui ne s'applique pas cette fois (acompte sous son seuil), ou une CFE de zéro sur l'avis |

Ce qu'une échéance demande : un **dépôt** (liasse, DAS2, 1330-CVAE,
1447-C-SD, 1447-M-SD, approbation et dépôt des comptes), un **paiement**
(acomptes d'IS, de TVA, de CFE et de CVAE, solde d'IS, CFE) ou **les deux**
(CA3, CA12, 1329-DEF). Une déclaration déposée avec un montant de zéro (un
crédit de TVA) n'a rien à payer.

### Enregistrer un dépôt ou un paiement

« Enregistrer » sur une échéance (droit `entries:create`, administrateurs et
comptables) ouvre un formulaire : date de dépôt, date de paiement (selon ce
que l'échéance demande), montant, « Non due cette fois » pour une échéance
conditionnelle, pièce justificative et note. Kledg ne stocke pas de fichier :
la pièce est une pièce déjà dans Kledg (une pièce jointe Qonto, par exemple
celle de l'opération bancaire du paiement, comme pour les notes de frais) ou
la référence d'une pièce gardée ailleurs (accusé de réception, avis).
« Retirer l'enregistrement » efface ce qui a été saisi.

Règles (`lib/declarations/mark-declaration.service.ts`) :

- l'échéance doit être une échéance du calendrier de la société (404
  sinon) ;
- une déclaration ne se « paie » pas et un paiement ne se « dépose » pas ;
  aucune date dans le futur ; une échéance non due n'a ni dépôt ni
  paiement ;
- seuls les champs envoyés changent (une valeur vide efface le champ) ; un
  enregistrement vidé de tout est supprimé ;
- la pièce doit appartenir à la société ;
- deux enregistrements simultanés de la même échéance passent l'un après
  l'autre (verrou par société et échéance) ;
- chaque changement est inscrit au journal d'audit (`MARK_DECLARATION`,
  `CLEAR_DECLARATION`).

### Jamais deux fois la même information

Ce qu'un autre module enregistre déjà alimente le même statut et ne se
saisit pas dans le suivi (`lib/declarations/sources.ts`) : le suivi refuse ce
champ (409) et indique la page où il s'enregistre.

| Échéance | Lu depuis | Champ verrouillé |
| --- | --- | --- |
| CA3, CA12 | Dépôt enregistré de la déclaration de TVA ([déclarations de TVA](declarations-tva.md)) : déposée à sa date, payée le même jour quand un montant est dû (la TVA se paie avec la déclaration, CGI art. 1692) | Dépôt et paiement |
| Liasse (2065) | Dépôt enregistré de l'impôt sur les sociétés ([impôt sur les sociétés](impot-societes.md)) | Dépôt |
| Acompte d'IS n | Acomptes versés de l'exercice sur la page Impôt sur les sociétés | Paiement |
| Approbation, dépôt des comptes | Dates de l'approbation des comptes ([approbation](approbation-des-comptes.md)) | Dépôt |
| CFE, acompte de CFE | Avis de CFE de zéro saisi dans les impôts locaux : non due | Rien |

Une note reste possible sur ces échéances, et « Non due » sur un acompte d'IS
sous son seuil. Un exercice que Kledg prévoit sans qu'il existe encore ne
verrouille rien.

### Où le statut apparaît

- Page Échéances : un badge par échéance (« Payée », « Déposée », « Non
  due », « en retard de 3 jours »...), ce qui a été enregistré, un filtre par
  statut, le bouton « Enregistrer » ;
- widget Échéances du tableau de bord ;
- page Impôts locaux, pour les échéances de CFE et de CVAE ;
- accueil du mode simple, liste « À faire » : les échéances en retard ou des
  30 prochains jours qui ne sont pas terminées, au plus quatre, en mots
  simples (« Payer la CFE », « En retard depuis le 15 juin, 1 750,00 € »),
  avec le montant enregistré ou celui de l'avis de CFE ;
- outils MCP `list_declarations_status` et `mark_declaration`.

## API et MCP

| Route | Droit | Effet |
| --- | --- | --- |
| `GET /api/deadlines?companyId=&fiscalYearId=` | `reports:read` | Les échéances de l'exercice avec leur règle, leurs sources et leur statut |
| `PUT /api/companies/[id]/declarations/status { deadlineId, filedOn?, paidOn?, amountCents?, notDue?, attachmentId?, attachmentReference?, note? }` | `entries:create` | Enregistre un dépôt, un paiement ou « non due » ; renvoie l'échéance et son statut |
| `DELETE /api/companies/[id]/declarations/status?deadlineId=` | `entries:create` | Retire l'enregistrement |

Les identifiants d'échéance sont ceux du calendrier : `cfe:2026`,
`cfe-acompte:2026`, `cvae-acompte:2026:1`, `is-solde:2026-12-31`,
`tva-ca3:2026-09`...

Outils MCP ([mcp.md](mcp.md)) : `list_tax_deadlines` (dates et règles),
`list_declarations_status` (statuts, filtres par catégorie et par statut,
comptes par statut) et, avec l'accès brouillons, `mark_declaration`
(enregistre ou retire ; refuse ce qu'un autre module enregistre). Aucun ne
dépose ni ne paie.

## Stockage

Table `declaration_statuses` (migration
`20261105090000_local_taxes_and_declaration_statuses`) : une ligne par
société et échéance (`companyId`, `deadlineId` unique), avec les dates, le
montant, la pièce (`attachmentId`, clé étrangère vers les pièces jointes,
effacée si la pièce disparaît) ou sa référence, la note, qui l'a créée et
modifiée. Contraintes de la base : identifiant au format du calendrier,
montant jamais négatif, pas de date pour une échéance non due, pas de ligne
vide. Table d'une société : les quatre politiques `kledg_rls_*` sur
`companyId` ([rls.md](rls.md)).

## Tests

- `lib/deadlines/__tests__/engine.test.ts`, `settings.test.ts`,
  `deadlines-routes.db.test.ts` : le calendrier règle par règle.
- `lib/local-taxes/__tests__/local-taxes.test.ts` : échéances de CFE et de
  CVAE, arrêt de la CVAE en 2030.
- `lib/declarations/__tests__/status.test.ts` : statuts, délai de
  télédéclaration, dépôt et paiement, faits des autres modules.
- `lib/declarations/__tests__/declarations.db.test.ts` (PostgreSQL, aussi
  avec `KLEDG_RLS=enforce`) : statuts depuis la TVA, l'IS, l'approbation et
  l'avis de CFE, enregistrements par rôle, refus des champs verrouillés,
  validations, mises à jour partielles et retrait, accueil du mode simple,
  contraintes de la base.
- `lib/mcp/__tests__/local-tax-tools.test.ts`, la matrice des autorisations,
  l'isolation des sociétés (`lib/rls/__tests__`) et
  `components/features/dashboard/__tests__/deadline-widget.test.tsx`.
