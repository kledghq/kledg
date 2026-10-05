# Factures et tiers

Le journal des achats et des ventes : les clients et fournisseurs (tiers), les factures reçues et émises enregistrées avec leurs lignes et leur TVA par taux, leur comptabilisation, leurs règlements venus de la banque, et leur import depuis Qonto. Kledg **enregistre** les factures, il ne les émet pas et ne les envoie pas. Code : `lib/tiers`, `lib/invoices`, `lib/integrations/providers/qonto/invoicing.ts`.

## Tiers

Page **Factures, Tiers** (`/tiers`), API `GET|POST /api/tiers`, `GET|PATCH|DELETE /api/tiers/[id]`, `POST /api/tiers/attach-auxiliary`, outil MCP `list_tiers`.

- **Client ou fournisseur**, propre à une société : nom, SIREN et SIRET (clé de Luhn vérifiée, exception de La Poste comprise), numéro de TVA intracommunautaire (clé vérifiée pour un numéro français, forme pour les autres), e-mail, adresse (une adresse de la société, supprimée avec le dernier lien qui l'utilise), notes.
- **Compte auxiliaire** (FEC `CompAuxNum`, LPF art. A47 A-1) : unique dans la société, C00001, C00002... pour les clients, F00001... pour les fournisseurs quand il n'est pas saisi. C'est lui qui relie le tiers aux lignes d'écriture : le lettrage, la balance auxiliaire et la balance âgée regroupent les lignes par compte auxiliaire et affichent le nom du tiers. Une fois que le tiers porte des factures, son compte auxiliaire ne change plus (les écritures passées ne sont jamais réécrites) et le tiers ne se supprime plus.
- **Comptes par défaut** : compte collectif (411 pour un client, 401 pour un fournisseur, ou un autre compte 41 ou 40, 404 pour les fournisseurs d'immobilisations par exemple), compte de charge (classe 6 ou 2) ou de produit (classe 7) proposé sur les lignes, taux de TVA proposé.
- **Délai de paiement** propre au tiers, sinon celui de la société ([lettrage et tiers](lettrage-et-tiers.md#balance-âgée)) : au plus 60 jours ou 45 jours fin de mois (Code de commerce art. L441-10, I, al. 2), vérifié à l'enregistrement et par une contrainte de la base. La balance âgée l'applique aux factures du tiers.
- **Créer depuis les écritures** : crée un tiers pour chaque compte auxiliaire déjà porté par des lignes des comptes 40 et 41 (import FEC par exemple), nommé d'après le libellé des lignes. Aucune ligne n'est modifiée ; un numéro déjà relié à un tiers est laissé tel quel ; un numéro présent à la fois sur des comptes clients et fournisseurs est signalé, jamais deviné. Relancer l'opération ne crée rien de plus.
- Droits : lecture `entries:read`, création `entries:create`, modification `entries:update`, suppression `entries:delete`.

## Factures

Pages **Factures, Factures d'achat** (`/invoices/purchases`) et **Factures de vente** (`/invoices/sales`), fiche d'une facture (`/invoices/[id]`). API `GET|POST /api/invoices`, `GET|PATCH|DELETE /api/invoices/[id]`, `PATCH /api/invoices/[id]/lines`. Outils MCP `list_invoices`, `get_invoice` et, en contrôle total, `create_draft_invoice`.

- **Une facture** : tiers (un client pour une vente, un fournisseur pour un achat), numéro, date, échéance, type (facture 380 ou avoir 381, codes UNTDID 1001), libellé, lignes.
- **Lignes** (CGI ann. II art. 242 nonies A, I, 8°) : désignation, quantité (trois décimales), prix unitaire hors taxe, taux de TVA propre à chaque ligne, compte, nature (bien ou prestation), immobilisation pour un achat. Une facture porte autant de taux que nécessaire. Seuls les taux français sont acceptés sur une facture saisie (20, 13, 10, 8,5, 5,5, 2,1, 1,75, 1,05, 0,9 et 0 %, CGI art. 278 à 281 nonies, 296 et 297) ; une société en franchise en base (CGI art. 293 B) ne facture pas de TVA.
- **Numéro** : unique dans la société pour une facture de vente (numérotation chronologique et continue, CGI ann. II art. 242 nonies A, I) ; unique par fournisseur pour une facture d'achat.
- **Échéance** : celle saisie, ou la date de la facture plus le délai du tiers, sinon celui de la société. Une échéance saisie à la main ne dépasse pas le plafond légal (60 jours après la facture, ou 45 jours fin de mois, le plus tardif des deux, Code de commerce art. L441-10).
- **Statut**, déduit et jamais enregistré : brouillon (aucune écriture), comptabilisée, payée partiellement, payée (voir Règlements). Une facture se modifie et se supprime tant qu'elle est en brouillon.

### Arrondis

Tous les montants sont des centimes entiers ; les taux sont en points de base (2000 pour 20 %). Règle (`lib/invoices/amounts.ts`, la même dans le formulaire et sur le serveur) :

1. **Ligne** : total hors taxe = quantité x prix unitaire, arrondi au centime, la demie au centime supérieur (arrondi commercial).
2. **TVA par taux** : sur la somme des totaux hors taxe des lignes de ce taux, arrondie de la même façon, jamais ligne par ligne. L'article 242 nonies A, I, 11° de l'annexe II du CGI exige « par taux d'imposition, le total hors taxe et la taxe correspondante » : le montant légal de TVA est celui du détail par taux, et l'arrondir une fois par taux garde la taxe égale au taux appliqué à la base. C'est aussi la règle de la norme EN 16931 (BR-CO-17), si bien qu'une facture Factur-X, UBL ou CII importée plus tard donne les mêmes montants. Exemple : trois lignes de 0,10 € à 5,5 % donnent 0,02 € de TVA (0,30 € x 5,5 % = 0,0165 €), et non 0,03 €.
3. **Total TTC** = somme des bases + somme des TVA.

Les totaux envoyés par un client de l'API sont ignorés : le serveur les recalcule. Une facture importée garde les montants du document (voir Qonto).

## Comptabilisation

Bouton **Comptabiliser**, `POST /api/invoices/[id]/post` (droit `entries:create`) ; `DELETE` supprime l'écriture tant qu'elle est en brouillon et qu'aucun règlement n'est enregistré (droit `entries:delete`).

La facture crée une **écriture en brouillon** datée du jour de la facture, au journal des achats (AC) ou des ventes (VE), par le chemin unique de création des écritures (`createEntryInTx` : équilibre au centime, journal et comptes de la société, exercice ouvert contenant la date). Comptes du PCG (art. 932-1, liste des comptes) :

| | Achat | Vente |
| --- | --- | --- |
| Tiers | 401 (ou le compte collectif du tiers) au crédit, TTC, avec le compte auxiliaire | 411 au débit, TTC, avec le compte auxiliaire |
| Lignes | Classe 6 (ou 2 pour une immobilisation) au débit, HT, une ligne par ligne de facture | Classe 7 au crédit, HT ; sans compte : 706 pour une prestation, 707 pour un bien |
| TVA | 44566 « TVA sur autres biens et services » au débit, par taux ; 44562 « TVA sur immobilisations » pour les immobilisations | 44571 « TVA collectée » au crédit, par taux ; 44574 pour les prestations sous le régime des encaissements |

- **Exercice** : celui qui contient la date de la facture, et lui seul. Aucun exercice ne la contient : refus (400) ; il est clôturé : refus (409). Kledg ne se rabat jamais sur un autre exercice.
- **Comptes** : cherchés dans le plan de comptes de cet exercice et de cette société, jamais reçus comme identifiants. Un code saisi doit exister tel quel ; un compte par défaut (401, 411, 44566, 706...) est trouvé par sa racine (401, puis 401000, puis le premier sous-compte). Un compte absent : refus avec le compte à créer.
- **Avoir** (381) : les mêmes lignes, sens inversés.
- **Franchise en base** (CGI art. 293 B) : la TVA d'un achat n'est pas déductible, elle s'ajoute à la charge de chaque ligne.
- **Un taux partagé** entre deux comptes de TVA (une immobilisation et une fourniture au même taux) : la TVA du taux se répartit au prorata des bases, le reste au centime sur la plus grosse, pour que les lignes de TVA fassent exactement la TVA du document.
- Une facture se comptabilise une fois : la ligne de la facture est verrouillée pendant la comptabilisation (deux clics simultanés donnent une écriture et un refus). Supprimer l'écriture en brouillon depuis Écritures ramène la facture en brouillon. Une écriture validée se corrige par contre-passation (PCG art. 1031-3). Une facture dont un règlement a été confirmé dans les recettes à vérifier du mode simple ne peut être ni décomptabilisée depuis la facture ni supprimée tant que ce rapprochement n'est pas annulé ([catégories simples](categories-simples.md#recettes-à-vérifier)).
- Taux étranger (facture importée d'un fournisseur européen) : refus, la TVA étrangère ou l'autoliquidation se saisit à la main.

### TVA sur les encaissements (CGI art. 269, 2, c)

La TVA d'une prestation de services est exigible à l'encaissement du prix ; la société peut opter pour la payer d'après les débits (l'option figure alors sur ses factures, CGI ann. II art. 242 nonies A, I, 11° bis). Les livraisons de biens sont taxées à la livraison (art. 269, 2, a).

- L'option se règle sur la page **Factures de vente** (`GET|PUT /api/companies/[id]/vat-settings`, droit `settings:update`). Par défaut : TVA sur les encaissements.
- Sans option, la TVA des lignes « prestation » d'une facture de vente va au compte **44574 « TVA collectée en attente d'encaissement »**, subdivision du 4457 que la société crée dans son plan de comptes (Kledg le demande s'il manque). Le 44587 n'est pas utilisé : le PCG le réserve aux factures à établir.
- À chaque règlement enregistré sur la facture, Kledg crée une **écriture en brouillon au journal OD**, datée du règlement et dans son exercice : 44574 au débit, 44571 au crédit, pour la TVA du règlement (TVA en attente x règlement / TTC, arrondie au centime ; le règlement qui solde la facture prend le reste, de sorte que les virements font exactement la TVA en attente). Retirer le règlement supprime ce brouillon.
- Un règlement lettré à la main dans Lettrage, sans passer par la facture, ne déplace pas la TVA : passez l'écriture vous-même.
- Achats : la TVA d'une prestation achetée à un fournisseur sous le régime des encaissements n'est déductible qu'une fois payée (CGI art. 271, I, 2). Kledg ne connaît pas le régime du fournisseur et passe la TVA au 44566 à la date de la facture : régularisez dans la déclaration de TVA si besoin. La page de la facture le rappelle.

## Règlements

Bloc **Règlements** de la fiche, `GET /api/invoices/[id]/payments/candidates`, `POST /api/invoices/[id]/payments`, `DELETE /api/invoices/[id]/payments/[paymentId]`, `POST /api/invoices/[id]/settle` (droits `entries:read` et `entries:update`).

- Un règlement vient de la banque : c'est la ligne d'une écriture **validée** et **rapprochée** avec une transaction bancaire, sur le même compte que la facture (401..., 411...), du côté opposé, du même tiers ou sans compte auxiliaire (une ligne de rapprochement n'en a souvent pas), non lettrée et pas déjà enregistrée sur une autre facture. Kledg propose ces lignes, les montants exacts en premier.
- Une ligne règle une seule facture, pour tout son montant, sans dépasser le reste à payer. Un virement qui règle plusieurs factures se lettre à la main dans Lettrage, avec toutes ses factures.
- **Paiement partiel** : Kledg n'a pas de lettrage partiel ([lettrage et tiers](lettrage-et-tiers.md#lettrage)). Un règlement qui ne solde pas la facture est enregistré sans lettrage : la facture est « payée partiellement » et son reste dû se déduit des règlements enregistrés.
- **Paiement complet** : dès que les règlements couvrent la facture, Kledg lettre la ligne de tiers de la facture avec les lignes des règlements par le service de lettrage (groupe équilibré, écritures validées, même exercice, code suivant du compte). Si ce n'est pas encore possible (écriture de la facture en brouillon, règlement sur l'exercice suivant), la facture est « payée », la raison est affichée et **Lettrer avec ses règlements** relance le lettrage plus tard. Un règlement sur l'exercice suivant se lettre avec les à-nouveaux dans Lettrage.
- Une facture lettrée à la main dans Lettrage est « payée ». Pour retirer un règlement d'une facture lettrée, délettrez-la d'abord.

## Import Qonto

Bouton **Importer de Qonto** des pages de factures, `POST /api/invoices/import-qonto` (droits `entries:create` et `banking:read`, limité comme tout appel bancaire). Lecture seule chez Qonto, avec la clé API déjà enregistrée pour la société.

Points d'accès utilisés, vérifiés dans la référence publique de l'API Business de Qonto (docs.qonto.com, le 4 octobre 2026), tous accessibles avec une clé API :

| Point d'accès | Portée OAuth | Ce que Kledg en tire |
| --- | --- | --- |
| `GET /v2/clients` | `client.read` | Clients : nom, e-mail, SIREN ou SIRET (`tax_identification_number`), TVA, adresse de facturation |
| `GET /v2/client_invoices` | `client_invoices.read` | Factures de vente : numéro, dates, statut, lignes (`items` : quantité, prix unitaire, taux en fraction « 0.2 », TVA), total, client, pièce |
| `GET /v2/supplier_invoices` | `supplier_invoice.read` | Factures d'achat : fournisseur, numéro, dates, statut, totaux, détail `taxes` (taux en pourcentage « 20 »), pièce ; pas de lignes |
| `GET /v2/attachments/{id}` | `attachment.read` | Le PDF de la facture : lien signé valable 30 minutes |

Non utilisés : Qonto ne publie pas de liste des fournisseurs (ils viennent des factures d'achat), et les points d'accès `/customers`, `/invoices`, `/payments`, `/vendors` et `/suppliers` qu'utilisait l'ancien client ne figurent pas dans la référence publique.

- **Idempotent** : un tiers est retrouvé par son identifiant Qonto, une facture par le sien ; relancer l'import ne crée rien deux fois. Un fournisseur sans identifiant connu est rapproché d'un tiers de même nom.
- Factures de vente : une ligne Kledg par ligne Qonto ; la TVA par taux est celle du document quand Qonto la donne, et le total doit égaler le total du document au centime. Les brouillons et factures annulées sont ignorés ; une ligne avec remise, ou des montants qui ne tombent pas juste, écartent la facture avec la raison.
- Factures d'achat : une ligne par taux, dont la base se déduit de la taxe (taxe / taux), le reste du total hors taxe allant au taux de 0 % s'il existe, sinon à la plus grosse base ; chaque base doit redonner sa taxe à un centime près. La TVA retenue est celle du document. Les factures rejetées ou écartées chez Qonto sont ignorées.
- Une facture importée est un brouillon qui garde les montants du document : choisissez le compte de ses lignes (ou un compte par défaut sur le fournisseur), puis comptabilisez-la. Une facture déjà comptabilisée garde ses montants ; seul son statut Qonto est mis à jour.
- **Pièce jointe** : Kledg ne stocke aucun fichier (il n'a pas de stockage de fichiers, les justificatifs bancaires fonctionnent de même). Il garde l'identifiant de la pièce et demande un lien frais à Qonto à chaque ouverture (`GET /api/invoices/[id]/attachment`) ; le lien n'est suivi que vers les hôtes de fichiers de Qonto, en https, vers une adresse publique, sans redirection, avec un délai et une taille maximale (`lib/integrations/providers/qonto/files.ts`).
- Tests : l'API est simulée sur l'adresse du bac à sable Qonto de la configuration (`QONTO_ENVIRONMENT=sandbox`), sans réseau.

## Facturation électronique

**Kledg n'est pas une plateforme agréée** (PA, longtemps appelée plateforme de dématérialisation partenaire) et ne se connecte à aucune : il ne reçoit, n'émet ni ne transmet de facture électronique, et ne fait pas d'e-reporting. Calendrier de la réforme (CGI art. 289 bis et 290, tels que modifiés par la loi n° 2026-103 de finances pour 2026, qui n'a pas changé les dates ; [impots.gouv.fr](https://www.impots.gouv.fr/professionnel/questions/partir-de-quand-suis-je-concerne-par-la-reforme-de-la-facturation)) :

| Date | Obligation |
| --- | --- |
| 1er septembre 2026 | Toutes les entreprises assujetties à la TVA établies en France doivent pouvoir **recevoir** les factures électroniques de leurs fournisseurs assujettis établis en France, par une plateforme agréée de leur choix. Les grandes entreprises et les ETI **émettent** leurs factures électroniques et transmettent leurs données de transaction (ventes aux particuliers, opérations internationales) et de paiement (e-reporting). |
| 1er septembre 2027 | Les PME et les microentreprises émettent à leur tour leurs factures électroniques et transmettent leurs données de transaction et de paiement. |

Ce que cela veut dire pour une société qui tient ses comptes dans Kledg :

- Choisissez une plateforme agréée (liste publiée par la DGFiP sur impots.gouv.fr) pour recevoir vos factures fournisseurs, et pour émettre vos factures de vente quand l'émission vous devient obligatoire. Le portail public de facturation n'est pas une plateforme d'échange entre entreprises (Chorus Pro reste celui des factures adressées au secteur public).
- Kledg enregistre ensuite ces factures en comptabilité : saisie, import Qonto, ou, plus tard, import du fichier. **Kledg n'importe pas encore de fichier Factur-X, UBL ou CII.**
- Les mentions de la réforme (SIREN du client, adresse de livraison si elle diffère, catégorie de l'opération, option pour le paiement de la TVA d'après les débits, CGI ann. II art. 242 nonies A, I, 1°, 7° bis, 8° bis et 11° bis) sont portées par le document émis par votre outil de facturation ou votre plateforme. Kledg garde celles dont la comptabilité a besoin.

Le modèle de facture de Kledg est déjà aligné sur la norme EN 16931, pour qu'un import électronique produise les mêmes données qu'une saisie :

- **Parties** : SIREN et numéro de TVA du vendeur et de l'acheteur, figés sur la facture tels que le document les porte (EN 16931 BT-30, BT-31, BT-47, BT-48), indépendamment de la fiche du tiers.
- **Type de document** : code UNTDID 1001 (`typeCode` : 380 facture, 381 avoir ; BT-3).
- **Détail de la TVA** par taux, enregistré (`invoice_vat_breakdowns`, BG-23 : base BT-116, taux BT-119, taxe BT-117), calculé par la règle EN 16931 pour une facture saisie, repris tel quel pour une facture importée.
- **Lignes** : quantité, prix unitaire net, taux, total net (BG-25 : BT-129, BT-146, BT-152, BT-131) et nature bien ou prestation (CGI ann. II art. 242 nonies A, I, 8° bis).
- **Source et identifiant externe** (`source`, `externalId`, unique) : un import électronique retrouvera ses factures par leur identifiant de plateforme, comme Qonto aujourd'hui.

Pour la suite : une source `EINVOICE`, un analyseur des formats (XML CII et UBL, PDF/A-3 Factur-X) qui produit les mêmes lignes et le même détail de TVA, à partir des factures que la plateforme agréée de la société lui remet. Kledg ne deviendra pas lui-même une plateforme agréée.

## Reprise de données d'un autre logiciel

Kledg ne contient aucun import d'archive. Un outil de migration externe (celui du fork privé, `scripts/ledgerly-migration`) peut reprendre les tables `invoices`, `customers`, `suppliers` et `payments` d'une archive Ledgerly vers ces tables, par le service (`createTiers`, `createInvoice`, `postInvoice`, `recordInvoicePayment`) plutôt qu'en SQL, pour garder les contrôles :

| Table Kledg | Champs à renseigner | Remarques |
| --- | --- | --- |
| `tiers` | `companyId`, `kind` (CUSTOMER pour un client, SUPPLIER pour un fournisseur), `name`, `siren`, `siret`, `vatNumber`, `email`, `auxiliaryAccountNumber` (le compte auxiliaire déjà porté par les écritures reprises, sinon laisser Kledg le choisir), `paymentTermsDays` et `paymentTermsEndOfMonth` (ou rien), `qontoId` (identifiant Qonto du client ou du fournisseur s'il est connu) | Un client et un fournisseur de même nom font deux tiers. Les identifiants invalides doivent être laissés vides. |
| `invoices` | `direction` (SALE ou PURCHASE), `tiersId`, `number`, `issueDate`, `dueDate`, `typeCode` (380 ou 381), `label`, `source` (QONTO quand la facture venait de Qonto, avec `externalId` = identifiant Qonto, sinon MANUAL), `externalAttachmentId` | Les totaux sont recalculés par Kledg à partir des lignes ; une facture à un seul taux sans lignes devient une ligne par taux. |
| `invoice_lines` | `label`, `quantity`, `unitPrice`, `vatRateBp` (taux x 100), `accountCode` (compte de charge ou de produit), `nature`, `fixedAsset` | |
| `invoice_vat_breakdowns` | rempli par Kledg | |
| `invoice_payments` | `entryLineId` : ligne de tiers de l'écriture bancaire rapprochée et validée qui règle la facture | Les règlements repris qui ne correspondent pas à une écriture rapprochée restent dans Lettrage. |

L'écriture d'une facture reprise est celle que `postInvoice` crée dans l'exercice de sa date ; une facture d'un exercice clôturé n'est pas comptabilisée (ses écritures sont déjà dans l'exercice, par le FEC).

## Limites

- Kledg n'émet ni n'envoie de facture, et ne gère ni acompte, ni retenue de garantie, ni facture en devise. Il ne produit donc pas les mentions obligatoires d'une facture (CGI ann. II art. 242 nonies A, Code de commerce art. L441-9) : votre outil de facturation en a la charge.
- Un avoir (381) n'enregistre pas la référence de la facture qu'il rectifie, que le document de l'avoir doit porter (BOI-TVA-DECLA-30-20-20-20) : indiquez-la dans le libellé.
- Les factures de frais de gestion sont numérotées par Kledg dans la série de la convention. Supprimer un brouillon qui n'est pas le dernier de la série laisse un trou dans la numérotation (CGI ann. II art. 242 nonies A, I, 7°) : annulez plutôt une facture émise par un avoir.
- Une facture d'achat importée de Qonto n'a qu'une ligne par taux : Qonto ne fournit pas les lignes des factures fournisseurs.
- La TVA des achats de prestations sous le régime des encaissements est passée à la date de la facture (voir plus haut).
