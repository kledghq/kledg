# Catégories simples et dépenses à vérifier

Le mode simple s'adresse aux personnes qui ne connaissent pas la comptabilité. Au lieu de choisir des comptes et des taux de TVA, elles confirment une **catégorie en langage courant** (« Téléphone et internet », « Repas d'affaires ») pour chaque paiement de la banque. Kledg en déduit l'écriture complète, et l'expert-comptable la valide.

Cette page décrit le catalogue des catégories, la façon dont Kledg propose une catégorie, les pages **Dépenses à vérifier** et **Recettes à vérifier**, la validation par l'expert-comptable et les outils MCP. Le code est dans `lib/simple`.

## Catalogue des catégories

`lib/simple/categories.ts` compte 72 catégories, regroupées pour la recherche : Locaux, Équipement, Achats et sous-traitance, Communication et logiciels, Déplacements et repas, Véhicule, Services et honoraires, Banque et finances, Personnel et dirigeant, Impôts et taxes, Mouvements d'argent, Recettes ; s'y ajoutent les **remboursements de dépenses** (voir [Recettes à vérifier](#recettes-à-vérifier)). Chacune donne :

- le **compte du PCG 2026** (art. 932-1, liste des comptes) parmi ceux que Kledg crée dans chaque plan (comptes de quatre chiffres au plus, plus 44562, 44566 et 44571) ;
- le **taux de TVA par défaut** (CGI art. 278 : 20 % ; art. 279 : 10 % pour la restauration et le transport de voyageurs ; art. 278-0 bis : 5,5 % pour les livres), remplacé par la TVA que la banque a lue sur le justificatif quand elle en donne une plausible (au plus 20 % de la base) ;
- la **règle de récupération de la TVA**, celle des notes de frais (`lib/expense-reports/vat-recovery.ts`) ;
- une phrase d'aide, des mots-clés de recherche et la **source** (article du PCG, article du CGI ou BOFiP).

Exemples :

| Catégorie | Compte | TVA | Récupération |
| --- | --- | --- | --- |
| Téléphone et internet | 626 | 20 % | totale |
| Logiciels et abonnements | 6511 (solutions informatiques, règlement ANC n° 2022-06) | 20 % | totale |
| Déplacements (train, avion, taxi, VTC) | 6251 | 10 % | aucune (CGI ann. II art. 206, IV, 2, 5°) |
| Hôtel en déplacement | 6256 | 10 % | aucune (206, IV, 2, 2°) |
| Repas d'affaires | 6257 ou 6256 | 10 % | totale (ancien art. 236, abrogé par le décret n° 2007-566) |
| Carburant | 6061 | 20 % | 80 % pour une voiture de tourisme (CGI art. 298, 4, 1°, a), totale pour un utilitaire |
| Location ou entretien d'un véhicule | 6135, 6155 | 20 % | aucune pour une voiture de tourisme (206, IV, 2, 6°) |
| Cadeaux clients | 6234 | 20 % | jusqu'à 73 € TTC par bénéficiaire (206, IV, 2, 3° ; ann. IV art. 28-00 A) |
| Assurances, frais bancaires, courrier | 616, 627, 626 | sans TVA | (CGI art. 261 C, 261, 4, 5°) |
| Cotisations sociales du dirigeant | 646 | sans TVA | |
| TVA payée aux impôts, impôt sur les sociétés | 4455, 444 | mouvement, une seule ligne | |
| Ventes de prestations | 706 | 20 % collectée (44571), ou le taux de la facture | |

Les mouvements qui ne sont ni des charges ni des produits (TVA payée, impôt sur les sociétés, salaires nets versés, charges sociales, emprunts, virements internes, retrait d'espèces, comptes courants, dividendes, capital) sont réservés en une seule ligne sur leur compte de tiers ou de trésorerie, sans TVA.

### Questions

Quelques catégories ne peuvent pas être comptabilisées sans une précision. Elles posent **une question** en langage courant, et chaque réponse dit quel compte et quelle règle de TVA s'appliquent :

| Question | Catégories | Réponses |
| --- | --- | --- |
| « Allez-vous l'utiliser plus d'un an ? » | Matériel informatique, Mobilier de bureau, Outils et machines | Oui : immobilisation (2183, 2184, 2155) avec la TVA au 44562, créée avec son plan d'amortissement ([Immobilisations](#immobilisations)). Non : charge (6063). Posée seulement au-delà de 500 € HT (tolérance BOI-BIC-CHG-20-30-10 ; PCG art. 212-1 et 213-1). |
| « Avec qui était ce repas ? » | Repas d'affaires | Avec des clients ou partenaires (6257, par défaut) ou seul en déplacement (6256). La note nomme les invités pour le comptable. |
| « C'est pour quel véhicule ? » | Carburant, Location ou leasing de véhicule, Entretien et réparation du véhicule | Voiture de tourisme ou utilitaire. |
| « Votre bail ou votre quittance mentionne-t-il de la TVA ? » | Loyer des locaux | Avec ou sans TVA (CGI art. 261 D, 2° et 260, 2°). |
| « Quelle TVA figure sur votre facture ? » | Ventes de prestations, de marchandises, de produits fabriqués | 20 % par défaut (CGI art. 278), 10 % (art. 279), 5,5 % (art. 278-0 bis), 2,1 % (art. 281 quater à 298 septies), sans TVA (exportations et livraisons intracommunautaires, art. 262 ter et 262, I ; services taxés chez le client, art. 259 et 283, 2 ; opérations exonérées, art. 261). La réponse par défaut laisse la vente confirmable d'un clic. |
| « Est-ce de l'argent que vous avez prêté à votre société ? » | Argent versé par un associé ou le dirigeant | Oui, un prêt : compte courant d'associé (455), rendu plus tard. Non, une augmentation de capital (1013, après la décision des associés, C. com. art. L223-32 et L225-127 à L225-129). Non, le paiement d'une vente : vente de prestations (706) avec sa TVA collectée. Aucune réponse par défaut : rien ne distingue les trois sur la ligne de la banque. |

La réponse sur le véhicule, sur le loyer et sur le taux de TVA d'une vente est reprise pour la même contrepartie la fois suivante ; celle sur un achat durable et sur l'argent d'un associé est redemandée à chaque fois.

### Immobilisations

Quand l'utilisateur répond « Oui » à « Allez-vous l'utiliser plus d'un an ? », Kledg crée l'immobilisation avec l'écriture, dans la même transaction de la base, par le service des immobilisations (`createFixedAssetInTx`, `lib/fixed-assets/create-fixed-asset.service.ts`) :

- **libellé** : la catégorie et la contrepartie (« Matériel informatique (Apple Store Opera) ») ;
- **valeur d'acquisition** : la ligne au débit du compte d'immobilisation, hors TVA récupérée (PCG art. 213-1 ; la TVA non récupérable reste dans le coût) ;
- **date d'acquisition et début d'amortissement** : la date de la transaction, le bien étant mis en service le jour de son paiement (PCG art. 214-13) ;
- **amortissement linéaire** sur la durée par défaut de la catégorie (`lib/simple/asset-lifetimes.ts`), au crédit du 2815 ou du 2818, en dotation au 6811 (PCG art. 932-1) ;
- **payée** (le paiement est la transaction bancaire), avec un commentaire qui rappelle d'où elle vient.

| Catégorie | Compte | Amortissement | Durée | Source |
| --- | --- | --- | --- | --- |
| Matériel informatique | 2183 | 2818 | 3 ans | usage admis pour le matériel informatique (obsolescence rapide), plus court que le matériel de bureau (10 à 20 %) |
| Mobilier de bureau | 2184 | 2818 | 10 ans | mobilier : 10 % par an |
| Outils et machines | 2155 | 2815 | 5 ans | outillage : 10 à 20 % par an (matériel : 10 à 15 %), durée la plus courte retenue |

Taux usuels : BOI-BIC-AMT-10-40-30, I-B et I-C ; durée d'utilisation : PCG art. 214-1 et 214-4, CGI art. 39, 1-2° (« d'après les usages de chaque nature d'industrie »). Le comptable peut changer la durée dans Immobilisations avant de comptabiliser la première dotation, par exemple pour une machine amortie sur 7 à 10 ans.

L'immobilisation est **liée à son écriture d'acquisition** (`fixed_assets.acquisitionEntryId`), et la ligne du mode simple la nomme (`simple_mode_entries.fixedAssetId`). Elle suit l'écriture :

- **annuler le rapprochement** ou **supprimer le brouillon** supprime d'abord l'immobilisation, selon les règles de suppression des immobilisations (`deleteFixedAssetsAcquiredByEntryInTx`, `lib/fixed-assets/delete-fixed-asset.service.ts`) : ses dotations en brouillon partent avec elle ; une dotation comptabilisée, ou une subvention d'investissement qui la finance, fait refuser l'annulation (409), avec la raison (« Le rapprochement ne peut pas être annulé : l'écriture n° ... a créé l'immobilisation « ... », qui ne peut pas être supprimée. Cette immobilisation a 1 dotation aux amortissements comptabilisée... ») ;
- **modifier le brouillon** la fait suivre sa ligne au compte d'immobilisation (`syncFixedAssetsAcquiredByEntryInTx`, `lib/fixed-assets/acquisition-entry.ts`), le compte étant reconnu par son numéro :
  - si l'écriture ne débite plus ce compte (le comptable requalifie l'achat en charge, 2183 remplacé par 6063), l'immobilisation est supprimée selon les mêmes règles et la ligne du mode simple ne la nomme plus ; une dotation comptabilisée fait refuser la modification (409 : « L'écriture n° ... ne peut pas être modifiée ainsi : elle a créé l'immobilisation « ... » au compte 2183, qui ne peut pas être supprimée. Cette immobilisation a 1 dotation aux amortissements comptabilisée... ») ;
  - si le montant débité change (une partie de l'achat passée en fournitures), il devient la valeur d'acquisition (PCG art. 213-1) et le plan d'amortissement, calculé depuis elle, suit ; les dotations pas encore comptabilisées, calculées sur l'ancienne valeur, sont supprimées avec leurs brouillons pour être recalculées. Une dotation comptabilisée fait refuser la modification (409, « ... amortie sur 1 249,17 €, et ne peut pas la porter à 1 000,00 €... contre-passez-la depuis la fiche de l'écriture avant de changer le montant ») : elle est définitive (PCG art. 1031-3) ;
  - une modification qui garde le compte et le montant (libellé, date, autres lignes) ne change pas l'immobilisation ;
- la clé étrangère (`ON DELETE NO ACTION`) refuse tout autre chemin qui supprimerait l'écriture en laissant l'immobilisation ;
- une immobilisation supprimée à la main dans Immobilisations laisse l'écriture telle quelle ; la ligne du mode simple ne la nomme plus.

Avec la validation par l'expert-comptable, l'immobilisation est créée avec le brouillon. La liste des saisies du mode simple l'indique sous la catégorie : « Immobilisation créée : Matériel informatique (Apple Store Opera), amortie sur 3 ans ». Si le comptable requalifie l'achat en charge en corrigeant le brouillon, l'immobilisation est supprimée avec la correction (voir ci-dessus).

Une société exonérée de TVA récupère la part donnée par son prorata du mois (`lib/accounting/vat-recovery-ratio.ts`) : rien pour une franchise sans ventes taxées. Elle ne collecte pas de TVA sur ses ventes.

Les comptes du catalogue sont ceux du plan que Kledg crée. Pour un plan importé d'un FEC, Kledg prend le compte détaillé (626000, sinon le plus petit sous-compte), sinon le compte parent le plus proche (`lib/simple/ledger-accounts.ts`). Sans compte proche, la dépense n'est pas enregistrée et l'utilisateur est invité à faire compléter le plan.

## Proposition d'une catégorie

`lib/simple/suggest.ts` est un moteur pur et déterministe. Pour une transaction non rapprochée, il propose une catégorie avec une confiance (haute, moyenne ou basse) et une raison en clair. Les signaux, dans l'ordre :

1. **Les règles d'affectation** de la société : la meilleure règle qui correspond (priorité, puis nombre de conditions). Confirmer applique les lignes de la règle, comme « Appliquer la règle » ; la catégorie affichée est celle de son compte principal.
2. **L'historique de la contrepartie** : les catégories choisies en mode simple et, pour les transactions rapprochées en mode expert, le compte de leur écriture. La contrepartie est normalisée comme pour les abonnements (`counterpartyKey`, `lib/subscriptions/detect.ts`). Le même choix les dernières fois donne une confiance haute (« Comme les 6 dernières fois »), un seul choix une confiance moyenne, des choix divergents une confiance selon leur part.
3. **Le dictionnaire des payeurs français** (`lib/simple/payees.ts`) : opérateurs, éditeurs de logiciels, hébergeurs, régies publicitaires, transporteurs, hôtels, stations-service, autoroutes et parkings, fournisseurs d'énergie, assureurs, banques en ligne, prestataires de paiement, greffes... L'URSSAF des indépendants va aux cotisations du dirigeant, l'URSSAF seule aux charges sociales des salariés ; les impôts (DGFIP) vont à la TVA, à l'impôt sur les sociétés, aux taxes locales ou au prélèvement à la source selon le libellé. Un payeur reconnu sans savoir ce qui a été acheté (Amazon, PayPal, la DGFIP sans détail) reste **à classer**, avec une indication.
4. **Les mots du libellé** : restaurant, loyer, péage, salaire, agios, retrait...
5. **La catégorie de la banque** (catégories Qonto), quand elle désigne une seule catégorie du catalogue.

Une catégorie de dépense n'est jamais proposée pour une entrée d'argent (seulement son remboursement), ni une recette pour une sortie ; le serveur refuse aussi de confirmer l'une pour l'autre (400). Seuls les choix faits du même côté de la banque comptent dans l'historique : un paiement de TVA ne dit rien d'un remboursement de TVA. En dessous de la confiance moyenne, rien n'est proposé : la ligne est « à classer ». Kledg n'invente jamais de catégorie.

Pour une entrée d'argent, Kledg cherche d'abord la **facture de vente payée** (voir [Recettes à vérifier](#recettes-à-vérifier)), puis les signaux ci-dessus, avec trois de plus après les mots du libellé : un **associé** de la société (nom d'un associé personne physique, Associés) pose la question de l'argent d'un associé ; un **client** connu (Tiers) propose une vente, de la catégorie de son compte de produits habituel ; un fournisseur habituellement payé (historique de dépenses) ou un payeur reconnu avec un mot de remboursement dans le libellé (REMBOURSEMENT, AVOIR, REFUND) propose le **remboursement** de cette dépense, en confiance moyenne au plus.

## Dépenses à vérifier

La page `/<société>/simple/depenses` (mode simple) liste les paiements non rapprochés, du plus récent au plus ancien, avec la catégorie proposée et sa raison :

- **OK** confirme la proposition ;
- **Modifier** ouvre la liste des catégories (recherche par mot, sans accent), la question éventuelle, la note pour le comptable et l'envoi du justificatif ;
- une ligne qui pose une question se règle d'un clic sur la réponse ;
- **Tout confirmer** ne confirme que les lignes de confiance haute sans question ; le serveur recalcule chaque proposition avant de confirmer ;
- une ligne dont la date n'est couverte par aucun exercice ouvert le dit et ne peut pas être confirmée.

Confirmer crée l'écriture par le service du rapprochement (`createEntryAndReconcile`) : la transaction est réservée sous verrou, l'écriture créée par le seul chemin de création (`createEntryInTx`) avec la ligne de banque au 512, la charge ou le produit et la TVA, au journal BQ, dans l'exercice de la date, puis liée à la transaction, le tout dans une seule transaction de la base. Une seconde confirmation répond 409. Annuler le rapprochement supprime le brouillon, comme pour tout rapprochement, et l'immobilisation créée avec lui (voir [Immobilisations](#immobilisations)).

Le **justificatif** d'une transaction Qonto part chez Qonto (API des pièces jointes, clés de la société), puis Kledg en reprend la référence ; Kledg ne stocke aucun fichier. Les autres banques n'ont pas d'API équivalente : l'utilisateur garde la facture pour son comptable (Code de commerce art. L123-22). L'envoi compte dans la limite d'appels bancaires de la société.

**Règle apprise** : quand les trois dernières confirmations pour une même contrepartie ont choisi la même catégorie, et que cette catégorie se comptabilise toujours de la même façon (pas de question qui dépend de l'achat, pas de récupération partielle de la TVA qu'une règle ne sait pas exprimer : carburant, cadeaux), Kledg crée une règle d'affectation « <contrepartie> (mode simple) » : contrepartie (ou libellé) et sens de l'opération, compte et TVA de la catégorie. Elle reste une suggestion (pas de création automatique). Trois choix identiques d'une autre catégorie mettent à jour la règle que le mode simple avait créée.

## Recettes à vérifier

La page `/<société>/simple/recettes` (entrée « Recettes » de la navigation simple, avec le nombre de crédits à identifier) liste l'argent reçu sur les comptes et pas encore rapproché, avec la même interface que les dépenses : OK, Modifier, question en un clic, note pour le comptable, « Tout confirmer » pour les seules lignes sûres, mêmes règles de validation par l'expert-comptable et même apprentissage des règles. Un lien mène aux factures de vente.

### Paiement d'une facture de vente

Pour chaque crédit, Kledg cherche d'abord la facture de vente ouverte qu'il paie (`lib/simple/match-invoice.ts`, pur) parmi les factures comptabilisées, hors avoirs, non lettrées (`lib/simple/invoice-receipts.service.ts`), au plus 500, la plus ancienne échéance d'abord. Le reste à payer est le total, moins les règlements enregistrés, moins les paiements confirmés en mode simple qui attendent la validation du comptable : une facture n'est pas proposée deux fois. Le crédit ne dépasse jamais le reste à payer (règle du module des factures). Il désigne la facture par :

- son **numéro** dans le libellé (lettres et chiffres comparés sans séparateurs, quatre caractères au moins dont un chiffre) ;
- le **SIREN** du client (neuf chiffres, espaces admis) ;
- tous les **mots significatifs du nom du client** (hors forme juridique et mots de deux lettres), dans la contrepartie ou le libellé.

| Cas | Confiance |
| --- | --- |
| Montant exact du reste à payer et facture désignée | haute, « Règle la facture n° F-2026-012 de Studio Nord » |
| Plusieurs factures désignées du même montant | moyenne, la plus ancienne échéance (le numéro départage) |
| Paiement partiel qui cite le numéro | moyenne |
| Montant exact sans nom, une seule facture ouverte de ce montant (remise de chèque) | moyenne |
| Paiement partiel qui nomme un client qui n'a qu'une facture ouverte | moyenne |
| Même montant sur des factures de clients différents | rien |

La facture passe avant toute catégorie, même avant une règle d'affectation : une vente déjà facturée n'est jamais comptée deux fois.

Confirmer n'ajoute **aucune règle comptable** : l'écriture est le règlement d'une créance, au journal BQ, dans l'exercice de la date du crédit, ligne de banque au débit du 512 et ligne client au crédit du compte client de la facture (même numéro, 411 ou son sous-compte, PCG art. 932-1), avec le compte auxiliaire du client. Le règlement est ensuite enregistré sur la facture par le module des factures (`recordInvoicePayment`, [factures et tiers](factures-et-tiers.md)), qui lettre la facture avec ses règlements quand ils la couvrent ; un paiement partiel reste sans lettrage, et la TVA d'une prestation exigible à l'encaissement passe de 44574 à 44571 (CGI art. 269, 2, c). Le module n'enregistre un règlement que depuis une écriture validée :

- sans validation par le comptable, l'écriture est validée aussitôt et le règlement enregistré dans la foulée ;
- avec la validation par le comptable (ou pour un assistant, toujours en brouillon), l'écriture reste en brouillon et la ligne `simple_mode_entries` garde la facture (`invoiceId`) : le règlement est enregistré quand l'écriture est validée, par la validation habituelle (`validateEntries`, `updateDraftEntry`, donc la validation en masse, le formulaire d'écriture et l'outil MCP `validate_entries`). La liste Saisies du mode simple montre « Paiement de la facture n° ... » et si le règlement est enregistré.

Un refus du module des factures après la validation (facture payée entre-temps, exercice clôturé) est consigné dans le journal du serveur et ne défait jamais la validation : le règlement s'enregistre alors depuis la page de la facture. Annuler le rapprochement d'un brouillon supprime l'écriture et rouvre la facture. Une facture nommée par un paiement du mode simple ne peut être ni décomptabilisée depuis la facture (« Un règlement de cette facture a été confirmé dans les recettes à vérifier... », 409) ni supprimée (clé étrangère `NO ACTION`).

### Catégories de recettes

| Catégorie | Compte | TVA | Source |
| --- | --- | --- | --- |
| Ventes de prestations, de marchandises, de produits fabriqués | 706, 707, 701 | collectée au taux de la facture (44571), voir la question | PCG art. 932-1 ; CGI art. 278 à 281 nonies |
| Paiement d'une facture déjà enregistrée (hors module des factures) | 411 | aucune | PCG art. 932-1 |
| Subvention d'exploitation (région, État, Bpifrance, CAF, ASP, France Travail) | 741 | hors champ (subvention sans contrepartie, BOI-TVA-BASE-10-10-10) | PCG art. 932-1, compte 74 |
| Intérêts reçus | 768 | exonérés (CGI art. 261 C, 1°) | PCG art. 932-1 |
| Indemnités et remboursements reçus (assurance) | 758 | aucune | PCG art. 932-1 |
| Argent versé par un associé ou le dirigeant | 455, 1013 ou 706 selon la réponse | sur une vente seulement | PCG art. 932-1 ; C. com. art. L223-32, L225-127 |
| Apport en capital | 1013 | aucune | PCG art. 932-1 |
| Emprunt reçu (banque, Bpifrance) | 164 | aucune | PCG art. 932-1 |
| Remboursement de TVA | 44567, jamais son compte parent | aucune | PCG art. 944-44 ; BOI-TVA-DED-50-20-20 |
| Dépôt de garantie rendu | 275 | aucune | PCG art. 932-1 |
| Dépôt d'espèces | 53 | aucune | PCG art. 932-1 |

Le **remboursement de TVA** solde le crédit de TVA reporté (44567), que la déclaration de TVA lit sur ce compte ([déclarations de TVA](declarations-tva.md)) : il n'est jamais passé sur le compte parent 4456, et sans compte 44567 dans le plan (créé par la liquidation d'une déclaration en crédit), la confirmation est refusée avec le message habituel du plan incomplet.

Les **remboursements de dépenses** (`remboursement:<catégorie>`, groupe « Remboursements de dépenses » de la liste) existent pour chaque dépense dont l'écriture ne dépend pas de l'achat : pas pour le matériel, le mobilier et les outils (qui peuvent être des immobilisations) ni pour les cadeaux (plafond de TVA par bénéficiaire). Depuis le PCG 2025 (règlement ANC n° 2022-06), les transferts de charges (79) disparaissent : un remboursement n'est pas un produit, il **diminue la charge** remboursée, avec la TVA qu'elle avait récupérée (rien sur un billet de train, 80 % sur le carburant d'une voiture de tourisme). Il n'apprend jamais de règle : une règle d'affectation ne sait pas exprimer une TVA reprise.

Le dictionnaire des payeurs reconnaît pour l'argent reçu : la DGFIP avec TVA (remboursement de TVA) ou avec IS (impôt sur les sociétés), Bpifrance avec SUBVENTION ou AIDE (subvention) et avec PRET ou DEBLOCAGE (emprunt), la CAF, l'Agence de services et de paiement, France Travail et l'Agefiph (subventions), un conseil régional avec SUBVENTION, les versements et dépôts d'espèces, les dépôts de garantie restitués, les intérêts créditeurs, les assureurs (indemnités). Une remise de chèque sans facture du même montant reste à classer, avec une indication.

Fonctions pour l'accueil du mode simple : `countExpensesToReview(companyId)` (`lib/simple/expenses-to-review.service.ts`) et `simpleValidationSummary(companyId, { from, to })` (`lib/simple/simple-validation.service.ts`), qui compte les écritures du mode simple de la période, validées et à valider.

## Validation par l'expert-comptable

Réglage de la société « **Faire valider les saisies du mode simple par l'expert-comptable** » (`companies.simpleModeAccountantReview`, `GET/PUT /api/companies/[id]/simple-mode-settings`, droit `settings:update`) :

- tant qu'il n'a pas été choisi, il est **activé dès qu'un membre a le rôle Comptable** (décision du mainteneur, 2026-10-04) ;
- activé, les écritures confirmées en mode simple restent en **brouillon « à valider »** : rien n'est définitif avant la validation (PCG art. 1031-3) ;
- désactivé, elles sont validées aussitôt quand l'utilisateur a le droit de valider les écritures, sinon elles restent en brouillon.

Chaque écriture du mode simple est marquée par une ligne de `simple_mode_entries` : catégorie, réponses, note, contrepartie normalisée, validation demandée, origine (page ou assistant), règle apprise, immobilisation créée. La table est protégée par la sécurité au niveau des lignes ([rls.md](rls.md)) ; une ligne disparaît avec son écriture.

En mode expert, **Saisie, Saisies du mode simple** (`/<société>/entries/simple-mode`, droit `entries:read`) liste ces écritures, les brouillons à valider d'abord, avec la catégorie, la réponse à la question, la note, l'immobilisation créée, l'absence de justificatif et les lignes de l'écriture. Le comptable les valide une par une ou ensemble par la validation habituelle (`POST /api/entries/bulk-validate`, numéro définitif dans l'ordre des dates), ou les corrige dans le formulaire d'écriture. Le récapitulatif du mois donne les écritures classées, validées et à valider.

## API

| Route | Droit | Rôle |
| --- | --- | --- |
| `GET /api/simple/expenses?companyId=&side=&limit=` | `banking:read` | Dépenses (`side=debit`, par défaut) ou recettes (`side=credit`) à vérifier avec leur proposition (catégorie, règle ou facture `suggestion.invoice`), le nombre total et le réglage de validation |
| `POST /api/simple/expenses/[id]/confirm` | `banking:reconcile` et `entries:create` | Confirmer la proposition, une catégorie (`categoryId`, `answers`), une règle (`ruleId`) ou, pour une entrée d'argent, la facture de vente qu'elle paie (`invoiceId`), avec une note ; 400 avec `question` tant qu'elle n'a pas de réponse ; 404 pour une facture d'une autre société ; 409 pour une facture déjà payée |
| `POST /api/simple/expenses/confirm-all` | `banking:reconcile` et `entries:create` | Tout confirmer : seulement les lignes sûres, les autres dans `skipped` avec la raison |
| `POST /api/simple/expenses/[id]/receipt` | `banking:reconcile` | Envoyer le justificatif d'une transaction Qonto |
| `GET /api/simple/entries?companyId=&status=&from=&to=` | `entries:read` | Saisies du mode simple et récapitulatif de la période |
| `GET/PUT /api/companies/[id]/simple-mode-settings` | `settings:read` / `settings:update` | Réglage de validation par l'expert-comptable |

## Assistants (MCP)

- `list_expenses_to_review` (lecture, `banking:read`) : les dépenses (`side: debit`, par défaut) ou les recettes (`side: credit`) à vérifier avec la catégorie proposée, ou pour une recette la facture qu'elle paie (`suggestion.invoice` : numéro, client, reste à payer, paiement partiel), la confiance, la source, la raison, la question à trancher et ses réponses, en euros.
- `accept_expense_suggestion` (brouillons, `kledg:write`, `banking:reconcile` et `entries:create`) : confirme une ligne par la même confirmation que la page, une catégorie, une règle ou une facture (`invoiceId`), toujours en **brouillon**, quel que soit le réglage ; le règlement d'une facture s'y enregistre quand une personne valide l'écriture ; ne crée jamais de règle d'affectation. Écrit `MCP_WRITE` au journal d'audit.

Voir [mcp.md](mcp.md).
