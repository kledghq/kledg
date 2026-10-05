# Espace groupe

Une holding a son **espace groupe** (`/<holding>/group`), ouvert depuis le sélecteur de société (section **Groupes**) ou l'entrée **États, Vue groupe** de la holding. Il remplace le menu de la société par celui du groupe, comme si le groupe était une société :

- le sélecteur affiche le groupe comme sélection courante : les **associés de la holding** en pile d'avatars (photo, à défaut les initiales ; une société avec son logo, à défaut ses initiales, en carré), du plus gros pourcentage au plus petit, trois au plus puis « +N », chacun nommé pour les lecteurs d'écran et dans son info-bulle (« Claire Vasseur, 60 % ») ; à défaut d'associé, le logo de la holding ; puis « Groupe <holding> » et le nombre de sociétés. Un associé sans nom, ou une société actionnaire que l'utilisateur ne lit pas, n'est pas montré ;
- l'en-tête de chaque page répète cette pile, le nom du groupe et le nombre de sociétés ;
- le menu ne liste que les pages du groupe, regroupées par vue, aucune page de société ; choisir une société dans le sélecteur ramène à ses propres pages ;
- le fil d'Ariane lit « Groupe <holding> > vue > page », l'onglet du navigateur « Page · Groupe <holding> · Kledg » ;
- sur téléphone, le même tiroir que pour une société, refermé après chaque choix ;
- l'exercice de la holding choisi dans une page reste choisi dans les autres.

## Cinq vues, chacune répond à une question

Le premier espace groupe avait douze pages, une par tableau. Elles sont regroupées en cinq vues, chacune pour une question qu'un dirigeant de groupe ou son expert-comptable se pose. Une vue est un groupe du menu et chacune de ses pages une entrée, avec sa propre adresse (`GROUP_VIEWS`, `components/layout/group-nav-config.ts`) : pas d'onglets dans les pages.

| Vue | Question | Pages |
| --- | --- | --- |
| **Pilotage** (`/group`, `/group/{comparison, evolution, ratios}`) | Comment se porte le groupe, et chacune de ses sociétés ? | Synthèse (chiffres clés après éliminations, contribution de chaque société avec sa part du chiffre d'affaires et du résultat, puis agrégat, éliminations et groupe ; état de chaque société ; déclarations en retard, transactions à rapprocher, brouillons), N et N-1 (comparaison par société et agrégat, graphique), Évolution (mois par mois), Ratios. Un **filtre société** vaut pour toutes les pages de Pilotage : les chiffres clés deviennent ceux de la société, la comparaison et les ratios ne montrent qu'elle (l'agrégat reste celui du groupe) |
| **Structure** (`/group/structure`, `/group/structure/{persons, participations, companies}`) | Qui détient quoi, qui dirige quoi ? | Organigramme (ci-dessous), Associés et dirigeants (pourcentages direct, indirect et total), Participations (tableau des filiales et participations), Sociétés (forme juridique, SIREN, dirigeants, chiffres clés) |
| **Trésorerie** (`/group/treasury`, `/group/treasury/flows`) | Où est l'argent du groupe, qui doit quoi à qui, où va la trésorerie ? | Soldes et perspectives (soldes bancaires par société et par devise, trésorerie comptable par mois, comptes courants et prêts entre sociétés et leurs écarts, perspectives), Flux entre sociétés (diagramme de flux et tableaux) |
| **Fiscalité** (`/group/tax`, `/group/tax/{integration, deadlines}`) | Que doit le groupe en impôt, quand, et une intégration fiscale serait-elle utile ? | Impôt sur les sociétés (chaque société et régime mère-fille), Intégration fiscale (simulation), Échéances (suivi des déclarations de chaque société) |
| **Opérations** (`/group/operations`, `/group/operations/{ledger, eliminations}`) | Qu'y a-t-il derrière un chiffre ? | Transactions (toutes les sociétés, consultation seule), Grand livre combiné, Éliminations (vue combinée et flux trouvés) |

Les anciennes adresses mènent à leur page par une redirection permanente (`LEGACY_GROUP_PAGES`) : `/companies`, `/persons` et `/participations` vers les pages de Structure ; `/deadlines` vers Fiscalité, Échéances ; `/transactions`, `/ledger` et `/eliminations` vers les pages d'Opérations. `/comparison`, `/evolution` et `/ratios` sont à nouveau des pages, de Pilotage. Un lien vers un ancien onglet d'une vue (`?vue=`) ouvre sa page (`groupTabUrl`).

La rémunération des dirigeants et la valorisation ne font pas partie de l'espace groupe.

Code : `lib/group` (purs et en centimes : `combine.ts`, `periods.ts`, `aggregate.ts`, `ownership.ts`, `structure.ts`, `tax-integration.ts`, `flows.ts`, `simple-home.ts`, `merge-pages.ts`, `deadline-summary.ts` ; `perimeter.ts` et `members.ts` vérifient les accès et lisent chaque société ; un service par rapport), vues `app/(company)/[companyId]/group/*` et `components/features/group` (`view-frame.tsx` pour l'en-tête des pages, un fichier par vue, les sections réutilisées par les vues), menu `components/layout/group-nav-config.ts`. API `GET /api/group/{summary, alerts, view, companies, indicators, evolution, treasury, participations, persons, structure, tax, deadlines, transactions, ledger, simple-home, export}`.

## Organigramme

Page Organigramme de Structure (`GET /api/group/structure`, `lib/group/structure.ts`, `get-group-structure.service.ts`), comme le schéma de l'ancienne application, réécrit :

- **nœuds** : les personnes et les sociétés qui détiennent des parts (photo d'une personne, à défaut ses initiales), la holding, ses filiales (logo, forme juridique, premier dirigeant), et une filiale non lue sous la forme « Société non accessible » ;
- **flèches** : du détenteur vers la société détenue, avec le pourcentage enregistré parmi les actionnaires de la société détenue ; entre deux sociétés, la catégorie : plus de 50 %, filiale (Code de commerce, art. L233-1), de 10 à 50 %, participation (art. L233-2) ;
- **niveaux** : les détenteurs hors du groupe en haut, la holding, puis chaque société un niveau sous la société du groupe la plus profonde qui la détient. Une chaîne ne passe jamais deux fois par la même société et compte au plus six sociétés : un cycle (deux sociétés qui se détiennent) ne boucle pas ;
- chaque société du groupe porte la détention de la holding, **directe et indirecte** (le produit des pourcentages le long de chaque chaîne de sociétés du groupe, additionné sur les chaînes, `ownership.ts`) ; le bouton « i » d'une carte montre qui la détient, directement et par le groupe, et ses dirigeants ;
- un clic sur une société ouvre ses propres pages ; boutons de zoom et « Ajuster à la largeur », défilement dans le cadre sur téléphone (le cadre s'ajuste à la largeur à l'ouverture) ; « Lire l'organigramme en texte » donne une phrase par détention pour les lecteurs d'écran ;
- HTML et SVG dessinés par Kledg, sans bibliothèque de graphes (la disposition est une fonction pure testée, `layoutStructure`).

Une filiale non lue n'a ni nom (sauf pour un membre dont le rôle ne permet pas de lire les états), ni identifiant (clé opaque `hidden-1`), ni pourcentage (il est dans son propre registre des associés, non lu) ; ses propres détentions dans des sociétés lues apparaissent, puisqu'elles sont inscrites dans les registres de ces sociétés. Les personnes et les sociétés hors du groupe ont des clés de position : une clé interne porte un email ou un identifiant.

## Trésorerie : flux entre sociétés et perspectives

- **Flux entre sociétés** (`lib/group/flows.ts`) : les flux que la vue combinée trouve, dans le sens de l'argent. Frais de gestion et factures : de l'acheteur vers le vendeur ; dividendes : de la société qui distribue vers celle qui reçoit ; prêts et avances en compte courant : du prêteur vers l'emprunteur ; factures non réglées : ce que la société cliente doit encore. Le montant est le plus grand des deux livres, l'écart entre eux est montré. Un diagramme de flux (Sankey, Recharts, déjà présent) a deux colonnes, qui paie et qui reçoit : une société qui paie et reçoit y figure une fois de chaque côté, sans cycle. Une seule couleur pour tous les flux : la nature est écrite dans l'info-bulle et le tableau ;
- **Perspectives** (`treasuryOutlook`) : le rythme moyen des trois derniers mois de la trésorerie comptable du groupe, les montants des échéances non réglées des 90 prochains jours enregistrés dans le suivi des déclarations, et la trésorerie dans trois mois au même rythme après ces échéances. Une projection simple, la page le dit, pas une prévision.

## Fiscalité

### Impôt sur les sociétés de chaque société

Chaque société lue est calculée comme sur sa propre page Impôt sur les sociétés ([impôt sur les sociétés](impot-societes.md), `buildCorporateTax`), sur son exercice qui correspond à celui de la holding, avec les droits de l'utilisateur pour les dividendes de ses filiales : résultat fiscal, impôt, taux réduit appliqué ou non, contribution sociale, solde du relevé 2572-SD et sa date, nombre de contrôles à revoir. Le lien mène à sa page.

**Régime mère-fille** : pour chaque détention entre deux sociétés lues, le pourcentage, le seuil de 5 % du capital (CGI, art. 145), les dividendes reçus et s'ils sont déduits dans l'impôt de la mère (quote-part de frais et charges de 5 %, art. 216). La forme nominative des titres et leur conservation deux ans restent à vérifier.

### Simulation d'intégration fiscale

Page Intégration fiscale de Fiscalité (`lib/group/tax-integration.ts`, outil MCP `simulate_tax_integration`). **Simulation indicative pour un exercice, à faire vérifier par un expert-comptable** : Kledg n'exerce pas l'option et ne dépose rien. Les règles, chacune avec sa source dans la page :

| Règle | Ce que fait la simulation | Source |
| --- | --- | --- |
| Société mère | Soumise à l'impôt sur les sociétés ; pas elle-même détenue à 95 % ou plus par une société soumise à l'IS (sinon c'est cette société qui serait tête de groupe) ; exercice de douze mois | CGI, art. 223 A ; BOI-IS-GPE-10-20-10 |
| Membres | Détenus à 95 % au moins par la mère, directement ou indirectement par des sociétés membres : les pourcentages successifs se multiplient et seules les chaînes par des membres comptent (calcul pas à pas jusqu'à ce que le périmètre ne change plus, `integrationInterests`) ; soumis à l'IS ; exercice de douze mois aux mêmes dates que la mère | CGI, art. 223 A ; BOI-IS-GPE-10-20-10 ; BOI-IS-GPE-10-30 |
| À confirmer | Résidence fiscale en France ; option notifiée par la mère avec l'accord de chaque filiale au plus tard à la date limite de dépôt de la déclaration de résultat de l'exercice précédent, pour cinq exercices | CGI, art. 223 A |
| Résultat d'ensemble | Somme des résultats fiscaux des membres, chacun tel que sa page le calcule (avant déficits) | CGI, art. 223 B |
| Dividendes entre membres | Éligibles au régime mère-fille : quote-part de frais et charges de 1 % au lieu de 5 %, donc 4 % des dividendes en moins ; hors régime mère-fille : déduits à 99 % | CGI, art. 216, I et 223 B ; BOI-IS-GPE-20-20-20-20 |
| Frais de gestion entre membres | Produit chez l'une, charge chez l'autre : neutres dans la somme, sans retraitement ; un écart entre les deux livres est signalé | CGI, art. 223 B |
| Retraitements à saisir | Provisions sur un autre membre, cessions d'immobilisations entre membres (art. 223 F), abandons de créances et subventions, limitation des charges financières du groupe (art. 223 B bis), autres : listés « Non calculé », comptés seulement quand l'utilisateur saisit le montant (positif ajouté au résultat, négatif déduit) | CGI, art. 223 A à 223 U |
| Déficits antérieurs | Chaque membre impute ses déficits d'avant le groupe sur son seul bénéfice ; la limite de 1 000 000 € majorés de 50 % s'applique au résultat d'ensemble (simplification : une fois sur le total) ; une perte du groupe se reporte au niveau du groupe | CGI, art. 223 I, 223 C, 209, I |
| Impôt du groupe | Taux réduit de 15 % **une seule fois**, sur 42 500 € du résultat d'ensemble, quand la somme des chiffres d'affaires des membres ne dépasse pas 10 000 000 € et que le capital de la mère remplit les conditions (libéré, 75 % de personnes physiques, réponses de sa page Impôt sur les sociétés) ; sinon 25 % ; une question sans réponse calcule au taux normal et indique le montant au taux réduit | CGI, art. 219, I, b |
| Contribution sociale | Une fois pour le groupe, 3,3 % de l'impôt au-delà de 763 000 € ; exonérée dans les conditions de la mère | CGI, art. 235 ter ZC |
| Comparaison | Somme des impôts et contributions des membres imposés séparément, face à l'impôt du groupe : l'économie, ou le surcoût (deux petits bénéfices au taux réduit chacun coûtent plus ensemble) | |

Le Conseil d'État (13 mars 2025, n° 481538) apprécie le chiffre d'affaires d'une société d'un groupe, intégré ou non, au niveau de tout le groupe : les chiffres séparés de chaque société viennent de ses propres réponses et peuvent devoir être revus. Une filiale non lue n'est pas dans la simulation, qui le dit. Les retraitements saisis dans la page sont recalculés dans le navigateur avec la même fonction pure (et passés à l'export) ; l'API les prend en centimes (`?provisions=`, `asset_sales`, `waivers`, `financial_charges`, `other`), l'outil MCP en euros.

Exemple (test `lib/group/__tests__/tax-integration.test.ts`) : H (résultat fiscal 12 500 €, après déduction des 50 000 € de dividendes de A et réintégration de la quote-part de 5 %, impôt 1 875 €), A détenue à 100 % (200 000 €, impôt 45 750 €), B détenue à 96 % (perte de 80 000 €). Résultat d'ensemble : 132 500 € moins 2 000 € (quote-part de 1 % au lieu de 5 %) = 130 500 € ; impôt du groupe 6 375 € (15 % sur 42 500 €) + 22 000 € (25 % sur 88 000 €) = 28 375 € ; séparément 47 625 € ; économie 19 250 €.

## Mode simple

En mode simple ([mode simple](mode-simple.md)), le menu du groupe devient quatre pages en mots simples, sans numéro de compte ni terme comptable (`SIMPLE_MODE_JARGON`, vérifié par les tests sur les pages rendues) ; `/group` ouvre l'accueil simple du groupe, sauf un lien qui nomme une page (`?vue=`). Le sélecteur Simple / Expert de la barre du haut ouvre, depuis une page du groupe, l'accueil du groupe du mode choisi.

| Page | Contenu | Source |
| --- | --- | --- |
| Accueil du groupe (`/group/simple`) | L'argent sur les comptes du groupe, ce que gagne le groupe depuis le début de l'année (« Bénéfice depuis janvier »), qui doit quoi à qui (« Atelier Lumen doit 25 000,00 € à Lumen Holding »), impôts et déclarations des six prochaines semaines et en retard, et « À faire » par société avec un lien vers ses pages simples | Soldes bancaires en euros de Trésorerie ; résultat après éliminations de Pilotage ; soldes entre sociétés ; suivi des déclarations ; alertes |
| Mes sociétés (`/group/simple/societes`) | Une carte par société : argent sur les comptes, ventes, bénéfice et prochaine déclaration, la part détenue par la holding | Les mêmes rapports |
| Qui possède quoi (`/group/simple/qui-possede-quoi`) | L'organigramme simplifié : les pourcentages, sans catégorie juridique ; une société ouvre ses pages simples | Structure |
| Argent entre mes sociétés (`/group/simple/argent-entre-societes`) | Les flux en phrases : « Lumen Holding facture 18 000,00 € à Atelier Lumen pour la gestion, soit 1 500,00 € par mois en moyenne », dividendes, prêts, avances | Flux entre sociétés |

`GET /api/group/simple-home` lit les mêmes rapports que les vues expertes (`getGroupView`, `getGroupTreasury`, `getGroupDeadlines`, `getGroupAlerts`) et ne calcule rien d'autre (`lib/group/simple-home.ts`) ; les tests comparent chaque chiffre aux rapports experts, au centime.

## Éliminations : une vue combinée indicative, pas des comptes consolidés

Kledg additionne les comptes des sociétés lisibles à 100 % et retire les flux intragroupe qu'il trouve. Ce ne sont **pas des comptes consolidés** :

- la consolidation suit le règlement ANC 2020-01 (intégration globale, intégration proportionnelle ou mise en équivalence selon le contrôle, élimination des titres contre les capitaux propres des filiales, intérêts minoritaires, écarts d'acquisition) ; aucune de ces opérations n'est faite ici ;
- l'obligation d'établir des comptes consolidés (Code de commerce, art. L233-16) et ses seuils d'exemption (art. L233-17) ne sont pas évalués ; l'établissement de comptes consolidés est hors du champ de Kledg.

Le pourcentage de détention est affiché, jamais appliqué : une filiale détenue à 60 % compte pour 100 % de ses chiffres. Les titres de participation restent à l'actif combiné (la page le signale avec leur montant), la part des minoritaires n'est pas isolée et les participations indirectes (la filiale d'une filiale) ne sont pas suivies.

## Le groupe

Une seule définition dans Kledg (`lib/management-fees/holding.ts`) : **une société est la holding d'une autre quand elle figure parmi ses actionnaires** (page Informations de la filiale, actionnaire « Société »), quel que soit le pourcentage. C'est la même définition que pour les [frais de gestion](frais-de-gestion.md) ; la section Groupes du sélecteur et l'entrée Vue groupe apparaissent pour les mêmes sociétés.

Les lignes d'actionnaires appartiennent à la filiale : un membre de la holding qui n'est pas membre d'une filiale ne peut pas les lire. La fonction `kledg_group_subsidiary_ids` (migration `20261030090000_group_subsidiaries`, `SECURITY DEFINER`) donne les identifiants des filiales d'une holding, et rien d'autre, uniquement si la holding elle-même est accessible au contexte qui la demande ([rls.md](rls.md)).

## Accès : chaque société est vérifiée

| Action | Holding | Chaque filiale |
| --- | --- | --- |
| Voir les pages de l'espace groupe | `reports:read` | `reports:read` |
| Exporter (CSV, Excel) | `reports:export` | `reports:read` |

- Une filiale dont l'utilisateur n'est pas membre, ou qu'un assistant IA n'a pas reçue dans son autorisation, est **comptée comme non accessible et jamais lue** : ni son nom, ni son identifiant, ni son SIREN, ni ses transactions, associés ou échéances ne sortent du serveur, sur aucune page ni dans aucun export ; ses chiffres ne sont pas additionnés et ses flux ne sont pas éliminés.
- Une filiale dont l'utilisateur est membre avec un rôle qui ne lit pas les états est nommée (il en est membre) et n'est pas lue.
- Chaque filiale lisible est lue dans son propre périmètre d'isolation (`inCompany`, `lib/management-fees/access.ts`) : la base décide encore d'après les adhésions de l'utilisateur et l'autorisation de l'assistant.

## Exercices

Pour l'exercice de la holding, Kledg lit dans chaque filiale l'exercice qui se termine le même jour, sinon celui qui recouvre le plus la période. Une filiale dont l'exercice a d'autres dates est additionnée telle quelle, avec un avertissement ; une filiale sans exercice sur la période n'est pas additionnée et la page le dit.

## Chiffres clés

Les mêmes règles que les [indicateurs financiers](indicateurs-financiers.md), sur les écritures validées de l'exercice, écriture de clôture exclue :

| Chiffre | Définition |
| --- | --- |
| Chiffre d'affaires | Comptes 70, crédit moins débit (2052 FL) |
| Excédent brut d'exploitation | Soldes intermédiaires de gestion (`sig.ts`) |
| Résultat de l'exercice | Produits moins charges |
| Trésorerie | Solde des comptes 512 en fin d'exercice ; le graphique additionne les soldes de fin de mois des sociétés lisibles |
| Capitaux propres | Total DL du bilan, résultat compris |
| Endettement financier | Emprunts et dettes financières (DS, DT, DU hors découverts, DV) |
| Total du bilan | Actif net du bilan au modèle PCG par défaut |

## Flux intragroupe

Kledg cherche, dans les livres de chaque société lisible, ce qui concerne une autre société lisible du groupe :

| Flux | Où | Comment la contrepartie est reconnue |
| --- | --- | --- |
| Frais de gestion | Factures préparées par les [frais de gestion](frais-de-gestion.md) | La facture liée à la facturation ; une facturation dont la facture n'est pas encore comptabilisée et validée est montrée, jamais éliminée |
| Factures entre sociétés du groupe | Factures de vente et d'achat dont l'écriture est validée dans l'exercice | Le SIREN de l'autre partie imprimé sur la facture, sinon celui du tiers |
| Créances et dettes commerciales | 401 à 409, 411 à 419, en fin d'exercice | Le SIREN du tiers du compte auxiliaire, sinon le libellé du compte |
| Comptes courants | 451, 455 | Idem |
| Prêts et avances | 267, 168 | Idem |
| Dividendes | 761 | Le tiers, sinon le libellé du compte, de la ligne ou de l'écriture (« Dividendes Filiale Nord 2025 ») |

Un libellé reconnaît une société quand il contient son nom (accents, ponctuation et forme juridique ignorés, mots entiers, au moins trois lettres) ou son SIREN. Nommez vos sous-comptes d'après la filiale (« 455100 Compte courant Filiale Nord », « 261100 Titres Filiale Nord ») pour qu'ils soient reconnus.

## Règles d’élimination

Seuls les flux dont les deux sociétés sont additionnées sont éliminés, une fois :

- **opérations** (frais de gestion, factures, intérêts) : les produits enregistrés par la société qui facture sortent des produits (du chiffre d'affaires pour les comptes 70, de l'EBE pour les produits d'exploitation), les charges enregistrées par la société facturée sortent des charges. Quand les deux livres concordent, le résultat combiné ne change pas ; sinon la différence apparaît comme un **écart** à justifier (une facture non enregistrée, enregistrée sur un autre exercice ou pour un autre montant) ;
- **dividendes** reçus d'une société du groupe : retirés du résultat combiné, puisque le résultat de la filiale qui les verse y est déjà ;
- **créances et dettes réciproques** en fin d'exercice : le plus petit des deux montants sort de l'actif et du passif combinés (et de l'endettement pour une dette en 16) ; la différence est un écart.

Trésorerie et capitaux propres ne sont pas modifiés par les éliminations.

### Exemple

Une holding H et deux filiales A (80 %) et B (60 %), en euros :

| | H | A | B | Agrégé |
| --- | ---: | ---: | ---: | ---: |
| Chiffre d'affaires | 50 000 | 400 000 | 200 000 | 650 000 |
| EBE | 10 000 | 60 000 | 20 000 | 90 000 |
| Résultat | 25 000 | 40 000 | 8 000 | 73 000 |
| Total du bilan | 320 000 | 260 000 | 90 000 | 670 000 |

Flux trouvés : H facture des frais de gestion à A (30 000, enregistrés 30 000 par A) et à B (20 000, enregistrés 18 000 par B) ; A vend à B pour 10 000 (607 chez B) ; H reçoit 15 000 de dividendes de A ; H a avancé 25 000 à A en compte courant ; B doit 12 000 à A.

| | Éliminations | Après éliminations |
| --- | ---: | ---: |
| Chiffre d'affaires | -60 000 (706 50 000, 707 10 000) | 590 000 |
| EBE | -2 000 (-60 000 de produits, +58 000 de charges) | 88 000 |
| Résultat | -17 000 (-2 000 d'écart, -15 000 de dividendes) | 56 000 |
| Total du bilan | -37 000 (25 000 et 12 000) | 633 000 |

L'écart de 2 000 sur les frais de gestion de B est signalé. Cet exemple est le test `lib/group/__tests__/combine.test.ts`.

## Filiales et participations

Page **Participations** de Structure, pour le tableau des filiales et participations des formulaires 2059-G-SD (régime réel normal) et 2033-G-SD (régime simplifié) et de l'annexe :

- **catégorie** : plus de 50 % du capital, filiale (Code de commerce, art. L233-1) ; de 10 à 50 %, participation (art. L233-2) ;
- détention et nombre de titres, tels qu'enregistrés parmi les actionnaires de la filiale ;
- **valeur des titres** dans les livres de la holding : sous-comptes 261 rattachés à la filiale par leur libellé, dépréciation 2961, valeur nette ; les titres qu'aucun libellé ne rattache sont listés à part, jamais devinés ;
- dans les livres de la filiale : capital (101, 104, 108), capitaux propres, chiffre d'affaires et résultat de l'exercice, et la **quote-part des capitaux propres** détenue (arrondie au centime) ;
- prêts et avances consentis par la holding (267, 451, 455 débiteurs) et dividendes encaissés (761).

## Agrégat, ratios et grand livre combiné

Comparaison, Ratios, Évolution et le grand livre combiné additionnent les comptes des sociétés lues à 100 %, compte par compte (`aggregate.ts`), sans retirer les flux intragroupe : c'est une **agrégation**, chaque page le dit. Les indicateurs de l'agrégat suivent les règles des [indicateurs financiers](indicateurs-financiers.md) appliquées à la somme des comptes : un ratio de l'agrégat est celui de la somme, pas la moyenne des sociétés. Les débits et les crédits s'additionnent séparément : un compte bancaire à découvert dans une société reste un découvert.

Exemple : une holding facture 30 000 de frais de gestion à sa filiale A et paie 10 000 de salaires ; A vend pour 200 000 et achète pour 90 000. L'agrégat a 230 000 de chiffre d'affaires (les frais compris) et 100 000 de résultat ; sa marge nette est 100 000 / 230 000 = 43,48 %. C'est le test `lib/group/__tests__/space.test.ts`.

Le grand livre combiné réunit un numéro de compte d'une société à l'autre : les comptes du PCG ont le même sens partout, les sous-comptes sont ceux de chaque société. Les lignes d'un compte sont celles des écritures validées de l'exercice, écriture de clôture exclue, les 1 000 plus récentes.

## Associés et dirigeants

Les associés viennent de la page Informations de chaque société lue (section Actionnaires) ; seuls le nom et la photo sortent, jamais la date de naissance, l'adresse ni les coordonnées. Une même personne enregistrée dans deux sociétés est réunie par son email, sinon par son nom (accents et casse ignorés). Les dirigeants sont ceux de la dernière approbation des comptes de chaque société.

Le **pourcentage indirect** est ce qu'un associé détient par les sociétés du groupe : le produit des pourcentages le long de chaque chaîne de détention, additionné sur les chaînes (`ownership.ts`). Il est indicatif et n'est appliqué à aucun chiffre.

Exemple : Claire détient 60 % de la holding H ; H détient 80 % de A et 40 % de B ; A détient 10 % de B ; Marc détient 40 % de H et 5 % de B en direct.

| | H | A | B |
| --- | ---: | ---: | ---: |
| Claire | 60 % direct | 48 % indirect (60 % x 80 %) | 28,8 % indirect (60 % x (40 % + 80 % x 10 %)) |
| Marc | 40 % direct | 32 % indirect | 5 % direct + 19,2 % indirect = 24,2 % |
| H | | 80 % direct | 40 % direct + 8 % indirect = 48 % |

Une chaîne qui passe par une filiale non lue manque : la page le signale. Une société qui en détient une autre qui la détient (cycle) ne compte qu'une fois par chaîne.

## Échéances, transactions

La page Échéances de Fiscalité lit le calendrier et le [suivi des déclarations](echeances.md) de chaque société pour son exercice qui correspond à celui de la holding : le même statut que sur la page Échéances de la société (dépôts de TVA, liasse et acomptes d'IS, approbation, statuts enregistrés). Rien ne s'enregistre depuis l'espace groupe.

Transactions fusionne les transactions des sociétés page par page (`merge-pages.ts`) : chaque société donne ses lignes après le curseur dans le même ordre (date puis identifiant, des plus récentes aux plus anciennes), la page garde les premières, et le curseur suivant est la dernière gardée ; aucune ligne n'est perdue ni répétée. Un filtre sur une société qui n'est pas lue répond « Société introuvable dans ce groupe. », qu'elle existe ou non.

## Exports et outils MCP

Chaque tableau a **Exporter en CSV** et **Exporter en Excel** (`GET /api/group/export?report=`) : `combined`, `participations`, `companies`, `indicators`, `evolution`, `treasury`, `persons`, `deadlines`, `transactions` (les 5 000 plus récentes, avec les filtres de la page), `ledger`, `structure` (nœuds et détentions de l'organigramme), `tax` (impôt par société, régime mère-fille, périmètre et simulation d'intégration avec les retraitements saisis, sources). Droit `reports:export` dans la holding, `reports:read` dans chaque filiale lue ; cellules protégées contre les formules (`lib/reports/csv-safe.ts`).

| Outil | Rôle |
| --- | --- |
| `get_group_view` | Vue combinée : chiffres par société, agrégés et après éliminations, flux et écarts, trésorerie par mois |
| `get_participations` | Tableau des filiales et participations |
| `get_group_companies` | Sociétés, détention, dirigeants, chiffres clés |
| `get_group_indicators` | Indicateurs N et N-1 par société et de l'agrégat |
| `get_group_evolution` | Produits, charges, résultat et trésorerie par mois |
| `get_group_treasury` | Comptes bancaires, trésorerie par mois, comptes courants entre sociétés |
| `get_group_shareholders` | Associés, pourcentages direct, indirect et total, dirigeants (sans photo) |
| `get_group_deadlines` | Échéances et statuts du suivi de chaque société |
| `get_group_alerts` | Déclarations en retard, transactions à rapprocher, brouillons |
| `list_group_transactions` | Transactions du groupe page par page |
| `get_group_ledger` | Grand livre combiné et lignes d'un compte |
| `get_group_structure` | Organigramme : nœuds, détentions et leur catégorie, détention directe, indirecte et totale, dirigeants |
| `simulate_tax_integration` | Impôt de chaque société, régime mère-fille, simulation d'intégration fiscale avec ses conditions, retraitements et sources |

Tous en lecture seule, avec `reports:read` dans la holding et dans chaque filiale lue. Un assistant n'atteint que les filiales de son autorisation : les autres sont comptées, ni lues ni nommées ([serveur MCP](mcp.md)).

## Ce que l'ancienne application faisait autrement

L'ancienne application multipliait les soldes de chaque société par le pourcentage de détention et appelait le résultat « consolidation » ; son bilan « consolidé » additionnait les totaux mais renvoyait les lignes de la première société, et ignorait sans le dire une société aux dates d'exercice différentes. Ses éliminations étaient seulement détectées et affichées, jamais appliquées. Trois définitions de la holding s'y contredisaient (une case à cocher, un type de société, les actionnaires), et le périmètre comprenait toute société détenue à plus de 1 %, lue sans être membre. Sa page Entreprises du groupe listait toutes les sociétés de la base ; la liste des personnes du groupe et les statistiques du groupe ne vérifiaient pas l'accès à la holding ; la page des impôts du groupe parcourait toutes les sociétés de la base et écrivait des déclarations lors d'une simple lecture. Son schéma de la structure du capital (trois rangées, associés, holding, filiales, déplaçables à la souris) est repris dans l'organigramme de Structure, avec les niveaux de détention indirecte, les catégories, les dirigeants et les filiales non accessibles. Kledg garde une définition, vérifie chaque société, n'écrit rien depuis l'espace groupe et appelle chaque chiffre ce qu'il est : combiné, agrégé, indicatif.
