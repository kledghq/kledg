# Conformité : ce que Kledg garantit et ce qu'il ne garantit pas

Pour les sociétés qui tiennent leurs comptes dans Kledg, leurs experts-comptables et commissaires aux comptes, et un vérificateur de l'administration fiscale. Chaque règle renvoie à son texte et au code qui l'applique. Textes vérifiés en octobre 2026 ; le plan comptable général (PCG) est le règlement ANC n° 2014-03 modifié, en dernier lieu par le règlement n° 2022-06 (exercices ouverts depuis le 1er janvier 2025), dont la numérotation est utilisée ici.

Kledg est un logiciel de comptabilité. Il n'est ni un logiciel de caisse, ni un logiciel de paie, ni une plateforme agréée de facturation électronique, et il n'est pas certifié par un organisme tiers. La société reste responsable de sa comptabilité (Code de commerce, art. L123-12 et suivants) : Kledg lui en donne les moyens, il ne la tient pas à sa place.

## Tenue de la comptabilité

| Exigence | Texte | Ce que fait Kledg |
| --- | --- | --- |
| Livre-journal et grand livre | C. com. art. R123-173 | Rapports Journal et Grand livre, établis depuis les seules écritures validées ; le journal s'exporte en Excel, l'ensemble des écritures dans le FEC. |
| Enregistrement opération par opération, avec l'origine, le contenu, l'imputation et la référence de la pièce | C. com. art. R123-174 | Chaque écriture porte un journal, une date, un libellé, une référence de pièce et une date de pièce (FEC PieceRef et PieceDate), et des lignes par compte. |
| Caractère définitif des enregistrements : une procédure de validation interdit toute modification ou suppression | PCG art. 1031-3 | Une écriture en brouillon reçoit son numéro définitif à la validation ; ensuite ni elle ni ses lignes ne changent, ni ne se suppriment : elle se corrige par une contre-passation. Refusé par le service et par la base (déclencheurs `kledg_guard_accounting_entry`, `kledg_guard_entry_line`). Seul le lettrage reste libre, il ne fait pas partie de l'écriture. |
| Numérotation continue, croissante dans le temps, sans rupture | BOI-CF-IOR-60-40-20 § 100 ; LPF art. A47 A-1 | Une séquence par exercice, commune à tous les journaux, attribuée à la validation sous un verrou : un brouillon supprimé ne laisse pas de trou. |
| Clôture des périodes, au plus tard avant la fin de la période suivante, qui fige la chronologie | PCG art. 1031-4 ; BOI-BIC-DECLA-30-10-20-40 § 130 et 140 | Page Exercices, **Clôture des périodes** : chaque exercice ouvert se clôture jusqu'à un jour choisi. Aucune écriture datée de la période ne peut plus être créée ni validée ; une opération oubliée se passe au premier jour ouvert, avec sa date réelle en date de pièce. La clôture est définitive et refusée tant que des brouillons sont datés dans la période. Le rythme (mois, trimestre) est celui que la société choisit : **c'est à elle de clôturer ses périodes à temps**, Kledg ne le fait pas automatiquement. |
| Clôture de l'exercice, inventaire | C. com. art. L123-12, R123-177 ; PCG art. 1031-4 | La clôture refuse un exercice qui a encore des brouillons, passe l'écriture de détermination du résultat (journal CL), ouvre l'exercice suivant avec les à-nouveaux (journal AN) et verrouille l'exercice : plus aucune écriture n'y est créée, modifiée ni supprimée (déclencheurs `kledg_lock_closed_year_*`). Un exercice clôturé ne se rouvre pas. |
| Journaux et comptes des écritures passées | PCG art. 1031-3 et 1031-4 ; LPF art. A47 A-1 | Le code d'un journal et le numéro d'un compte qui portent des écritures validées ne changent plus ; les libellés d'un exercice clôturé non plus (migration `20261107090000_ledger_references_lock`). |
| Permanence du chemin de révision | PCG art. 1011-3 | Chaque écriture garde sa pièce (référence et date), la transaction bancaire qui l'a créée, la facture ou la note de frais qu'elle comptabilise et, pour une contre-passation, l'écriture qu'elle annule. Les états (bilan, compte de résultat, balance, liasse) se recalculent depuis les écritures validées. |
| Plan de comptes | PCG art. 932-1 (liste des comptes, règlement ANC n° 2022-06) | Plan des nouvelles sociétés conforme à la liste en vigueur : comptes 657 et 757 des cessions, 672 et 772, 7587, plus de comptes 79 (transferts de charges supprimés). Les plans des exercices antérieurs à 2025 restent tels qu'ils étaient. |
| Conservation des documents comptables pendant 10 ans | C. com. art. L123-22 | Une société qui a une écriture validée ou un exercice clôturé ne se supprime pas (refus du service et de la base) : elle s'archive, en lecture seule. Le journal d'audit est en ajout seul et ne se purge qu'au-delà de 10 ans ([configuration](configuration.md)). |

### Ce qui reste à la charge de la société

- **Pièces justificatives** (C. com. art. L123-22 ; LPF art. L102 B, 6 ans au moins, dans leur format d'origine pour une facture électronique). **Kledg ne stocke aucun fichier** : il garde la référence et la date de la pièce et, pour Qonto, l'identifiant du document chez la banque, qu'il ne peut plus lire si le compte Qonto est fermé. Conservez vos factures et justificatifs dans un système d'archivage qui le permet pendant 10 ans.
- **Sauvegardes** d'une instance auto-hébergée : la base de données est la comptabilité. Sauvegardez-la et gardez les sauvegardes 10 ans au moins, avec le moyen de les relire ([auto-hébergement](self-hosting.md)).
- **Description des procédures comptables** (C. com. art. R123-172) et **documentation du système** (PCG art. 1011-4 ; BOI-BIC-DECLA-30-10-20-40 § 270 à 350) : ce document, la documentation de Kledg et son code source ouvert en sont la base ; la société décrit en plus son organisation (qui saisit, qui valide, à quel rythme les périodes sont clôturées, où sont archivées les pièces).
- **Clôture des périodes à temps** et clôture de l'exercice.

## Bilan et compte de résultat

États, Bilan et Compte de résultat ; code : `lib/reports/statements`. Deux présentations, chacune calquée sur les formulaires de la liasse fiscale du millésime 2026 (règlement ANC n° 2022-06 appliqué) : le système de base, sur les formulaires 2050-SD à 2053-SD (PCG art. 821-1 et 821-3), et le système simplifié, sur les formulaires 2033-A-SD et 2033-B-SD.

- **Chaque compte du plan de Kledg a sa case** dans chaque présentation, en solde débiteur comme en solde créditeur. La table complète est `lib/reports/statements/__tests__/fixtures/pcg-account-boxes.ts`, revue compte par compte et vérifiée par les tests : aucun compte sans case, aucun compte sur deux lignes, aucune case qui n'existe pas sur le formulaire de 2026.
- **Soldes selon leur sens** : les soldes débiteurs vont à l'actif et les soldes créditeurs au passif. Une banque créditrice (512) est un concours bancaire, en 2051 DU ou en 2033-A 156. Un fournisseur débiteur (401) est une autre créance (BZ, 072) et un client créditeur une autre dette (EA, 175). Les avances versées (4091) et reçues (4191) ont leurs lignes (BV, DW ; 064, 164).
- **Colonnes de l'actif** : les amortissements et dépréciations (28, 29, 39, 49, 59) figurent dans la colonne Amortissements de leur actif. Par exemple, la dépréciation des titres de participation (2961) est en CT et celle des prêts (2974) en BG.
- **Résultat** : la case du résultat (DI, 136) reçoit le résultat du compte de résultat (HN, 310), plus un résultat antérieur pas encore affecté (comptes 12). Le bilan est équilibré dès que les écritures le sont. Les écritures de clôture (journal CL) sont exclues des états.
- **Exercice précédent** : la comparaison N-1 utilise la même présentation pour les deux exercices.

Là où les formulaires et leurs notices de 2026 n'ont pas de case dédiée, Kledg retient la règle suivante, avec sa source :

| Compte | Système de base | Système simplifié | Source de la décision |
| --- | --- | --- | --- |
| Droit au bail (206) | Fonds commercial (AH) | Fonds commercial (010) | Notice 2033-NOT-SD 2026, ligne 010 : « Il comprend notamment le droit au bail » ; formulaire 2050 de 2025 (« dont droit au bail » sur AH) ; liste des comptes du PCG (206 et 207 ensemble). |
| Comptes d'associés créditeurs (45), dépôts du personnel (426) | Emprunts et dettes financières divers (DV) | 173 pour 455 ; 156 pour 426 ; Autres dettes (175) pour les autres comptes 45 | Liste des comptes du modèle de bilan du PCG (dettes financières diverses) ; ligne 173 « Comptes courants d'associés » de la 2033-A ; tables de correspondance de la pratique (DV : 165, 166, 168, 17, 426, 45). |
| Réserves indisponibles (1062) | Réserves réglementées (DF) | 130 | Tables de correspondance de la pratique (1062 et 1064 en réserves réglementées). |
| Acomptes sur dividendes (1209) | En moins du résultat (DI) | En moins du résultat (136) | Les acomptes se déduisent du bénéfice qu'ils anticipent ; aucune case dédiée sur la 2051 ni la 2033-A. |
| Frais d'établissement (201) | AB | Autres immobilisations incorporelles (014) | Pas de ligne sur la 2033-A ; la ligne 014 reçoit les immobilisations incorporelles autres que le fonds commercial (notice). |
| Primes d'émission (104) | DB | Capital (120) | Pas de ligne sur la 2033-A ; tables de la pratique (104 en 120). |
| Capital souscrit non appelé (109) | AA | Autres créances (072) | Pas de ligne sur la 2033-A ; c'est une créance sur les associés (ligne 072 : « associés »). |
| Fonds non remboursables et avances conditionnées (167), droits du concédant (229) | DM pour les titres participatifs (16711), DN ; 229 dans le total DO | Emprunts et dettes assimilées (156) ; 229 en Autres dettes (175) | Pas d'« autres fonds propres » sur la 2033-A. |
| Frais d'émission d'emprunt (481), primes de remboursement (169) | CW, CM | Charges constatées d'avance (092) | Pas de ligne sur la 2033-A ; comptes de régularisation de l'actif. |
| Écarts de conversion (474, 476 ; 475, 477) | CN ; ED | Autres créances (072) ; Autres dettes (175) | Pas de ligne sur la 2033-A. |
| Instruments financiers à terme et jetons (52) | Autres créances (BZ) en solde débiteur ; D1 en solde créditeur | 072 ; 175 | La 2050 n'a pas de case pour eux à l'actif. |
| Travaux (704, 7094) | Services (FG), ou biens (FD) pour une société du secteur « construction » | 218, ou 214 | Notices : FF et 214 visent « les travaux effectués par les entreprises qui fournissent à la fois la main-d'œuvre, les matériaux » ; FI et 218 « les travaux, études et prestations ». Le secteur d'activité de la page Informations décide de la mise en page par défaut ; l'éditeur de mise en page permet de déplacer les comptes. |
| Cessions (657, 757) | G1, F1 | Autres charges (262), Autres produits (230) | Notice 2033-NOT-SD 2026, cadre de la 2033-E (lignes 115 et 148) : 757 parmi les autres produits de gestion courante (752 à 758), 657 parmi les autres charges (651 à 658). |
| Quote-part des subventions d'investissement (747) | FO | 226 | Compte de la classe 74 « Subventions d'exploitation ». |
| Dotations aux dépréciations et provisions d'exploitation (6815, 6816, 6817) | GB, GC, GD | 256 | Ligne 256 « Dotations aux dépréciations » en 2026 ; la ligne 254 ne garde que les amortissements (notice). |
| Opérations faites en commun (655, 755) | GI, GH | Autres charges (262), Autres produits (230) | La 2033-B n'a pas de ligne pour elles (cadre 2033-E de la notice : 755 et 655 sont des produits et charges de gestion courante, exclus de la seule valeur ajoutée). |
| Participation des salariés (691) | HJ | Impôt sur les bénéfices (306) | La 2033-B n'a pas de case pour la participation (pas d'équivalent de HJ ni de WU) ; la classe 69 « Participation des salariés, impôts sur les bénéfices » est reportée ensemble, le résultat (310) reste exact. |

## Fichier des écritures comptables (FEC)

Page États, FEC ; `GET /api/fec` ; outil MCP `export_fec`. Code : `lib/fec`.

| Exigence (LPF art. A47 A-1, BOI-CF-IOR-60-40-20) | Ce que fait Kledg |
| --- | --- |
| Un fichier par exercice, nommé `SirenFECAAAAMMJJ` (date de clôture) | `123456789FEC20261231.txt` ; refus sans SIREN valide. |
| Les 18 zones, dans l'ordre, noms en première ligne | Oui, de `JournalCode` à `Idevise`. |
| Séparateur : tabulation ou « \| » | Tabulation ; les tabulations, « \| » et retours à la ligne des libellés sont remplacés par une espace. |
| Jeu de caractères : ASCII, ISO 8859-15 ou UTF-8 (XII, 1°) | UTF-8 sans marque d'ordre des octets. |
| Montants avec virgule décimale, sans séparateur de milliers ; dates AAAAMMJJ | Oui ; montants exacts au centime. |
| Écritures validées, après opérations d'inventaire, « hors écritures de centralisation et hors écritures de solde des comptes de charges et de produits » (VII, 1°) | Seules les écritures validées ; l'écriture de détermination du résultat (journal CL) est exclue, si bien que les classes 6 et 7 du fichier donnent le résultat. Le rapport d'export signale les brouillons restants, absents du fichier. |
| À-nouveaux en tête (VII, 3° ; BOFiP § 100) | Les écritures des journaux AN, RAN et OU sont placées en tête. Leur numéro est celui de leur validation : quand l'exercice précédent est clôturé tard, les à-nouveaux portent un numéro supérieur à des écritures de l'exercice déjà validées, ce que le BOFiP admet (§ 110). |
| ValidDate obligatoire (§ 250) | Date de validation de l'écriture, en heure de Paris. |
| Contrôle | Kledg contrôle le fichier à l'export (nom, zones, formats, équilibre de chaque écriture et du fichier, continuité de la numérotation). Ce contrôle est celui de Kledg : testez aussi le fichier avec **Test Compta Demat** de la DGFiP avant de le remettre. Aucun de ces contrôles ne vaut certificat de conformité. |

## Factures

Kledg **enregistre** les factures d'achat et de vente ; il ne les **émet** pas et ne les envoie pas ([factures et tiers](factures-et-tiers.md)).

- Les mentions obligatoires d'une facture (CGI ann. II art. 242 nonies A ; Code de commerce art. L441-9 : échéance, pénalités de retard, indemnité forfaitaire de 40 € pour frais de recouvrement, escompte) sont portées par le document émis par votre outil de facturation ou votre plateforme. Kledg en garde ce dont la comptabilité a besoin : numéro (unique dans la société pour une vente), dates, parties et leurs SIREN et numéros de TVA, lignes, nature bien ou prestation, TVA par taux, type facture ou avoir.
- Un avoir n'enregistre pas la référence de la facture qu'il rectifie (exigée sur le document, BOI-TVA-DECLA-30-20-20-20) : mettez-la dans son libellé.
- Factures de frais de gestion : numérotées par Kledg dans la série de la convention (CGI ann. II art. 242 nonies A, I, 7°). Ne supprimez pas un brouillon déjà transmis : annulez la facture par un avoir, sinon la série a un trou.

### Facturation électronique

**Kledg n'est pas une plateforme agréée** et ne se connecte à aucune. Il ne reçoit, n'émet ni ne transmet de facture électronique, et ne fait pas d'e-reporting. Depuis le 1er septembre 2026, toute société assujettie doit pouvoir recevoir ses factures par une plateforme agréée ; les grandes entreprises et les ETI émettent depuis cette date, les PME et microentreprises à partir du 1er septembre 2027 (CGI art. 289 bis et 290, loi n° 2026-103 de finances pour 2026). Choisissez une plateforme agréée ; Kledg comptabilise ensuite les factures. Kledg n'importe pas encore de fichier Factur-X, UBL ou CII.

## Impôts et déclarations

Kledg prépare les déclarations depuis les écritures validées et les explique ligne par ligne ; **la société les dépose et les paie sur impots.gouv.fr** ([TVA](declarations-tva.md), [impôt sur les sociétés](impot-societes.md), [impôts locaux](impots-locaux.md), [échéances](echeances.md)). Règles vérifiées pour 2026 : taux de TVA de 20, 10, 5,5 et 2,1 % ; suppression du régime simplifié de TVA au 1er janvier 2027 (loi n° 2025-127, art. 38 : dernière CA12 pour 2026) ; IS à 25 % et 15 % jusqu'à 42 500 € sous conditions, contribution sociale de 3,3 % ; acomptes d'IS les 15 mars, juin, septembre et décembre, solde le 15 du quatrième mois qui suit la clôture ; CVAE au taux maximal de 0,28 % en 2026 et 2027 ; CFE avec acompte du 15 juin au-delà de 3 000 € et solde du 15 décembre ; DAS2 au-delà de 2 400 € par bénéficiaire.

Kledg ne calcule pas : la contribution exceptionnelle sur les bénéfices des grandes entreprises (chiffre d'affaires d'au moins 1 milliard d'euros, loi n° 2025-127 art. 48 prorogée par la loi n° 2026-103 art. 12), la paie et les déclarations sociales, la liasse fiscale complète à déposer (il en prépare une partie des lignes).

## Paie

La paie et les données de salaire sont **hors du périmètre** de Kledg : il ne calcule ni bulletin, ni cotisation, ni déclaration sociale nominative. Les salaires y entrent comme des écritures (comptes 421, 431, 641, 645...) passées depuis le journal de paie de votre logiciel ou de votre prestataire, sans données nominatives au-delà du libellé que vous saisissez.

## Données personnelles (RGPD)

La société qui utilise Kledg est **responsable du traitement** des données personnelles qu'elle y enregistre (règlement (UE) 2016/679, art. 4, 7°) ; l'hébergeur de l'instance (la société elle-même, ou l'opérateur de l'offre hébergée, sous-traitant au sens de l'art. 28) les conserve pour elle. La politique de confidentialité de l'offre hébergée ne relève pas de ce document.

| Données | Pourquoi | Durée |
| --- | --- | --- |
| Utilisateurs (nom, e-mail, sessions) | Accès à l'instance, piste d'audit | Le compte, jusqu'à sa suppression par l'utilisateur ou un administrateur ; le journal d'audit 10 ans. |
| Personnes physiques : associés, dirigeants, bénéficiaires de notes de frais (nom, coordonnées, adresse, photo facultative, date et lieu de naissance facultatifs) | Composition du capital (formulaire 2033-F / 2059-F), approbation des comptes, notes de frais | Tant que la société en a besoin ; ne saisissez la date et le lieu de naissance que pour les formalités qui les demandent, et la photo seulement si elle vous sert. |
| Tiers personnes physiques (nom, SIREN, adresse, e-mail) | Factures, lettrage | Avec les factures et les écritures. |
| Écritures, factures, notes de frais, opérations bancaires | Comptabilité | 10 ans (C. com. art. L123-22). |

Droits des personnes, page Informations, **Données personnelles** (`/api/companies/[id]/persons/[personId]`) :

- **Accès et portabilité** (art. 15 et 20) : export en JSON de toutes les données détenues sur la personne et de ses liens.
- **Rectification** (art. 16) : chaque donnée de la fiche (`PATCH`).
- **Effacement** (art. 17) : la fiche, les coordonnées, la photo, les données de naissance et l'adresse sont effacées. L'effacement ne s'étend pas à ce que la loi oblige à conserver (art. 17, 3, b) : **les écritures comptables, les notes de frais et les factures restent 10 ans**, avec le nom qu'elles portent. Un associé ne s'efface qu'une fois sa participation retirée.

## Points à faire valider par un professionnel

Kledg applique les textes tels que nous les lisons ; ces points relèvent de l'appréciation d'un expert-comptable ou d'un avocat :

- le rythme de clôture des périodes adapté à la société, et la description de ses procédures comptables ;
- la numérotation des à-nouveaux dans une séquence unique par exercice quand l'exercice précédent est clôturé tard (BOFiP § 110) ;
- l'archivage probant des pièces justificatives hors de Kledg ;
- la déclaration trimestrielle de TVA des anciennes sociétés au réel simplifié à partir de 2027 ;
- l'étendue de l'effacement d'une personne au regard de la conservation des documents sociaux (registres, procès-verbaux d'assemblée), qui relève du droit des sociétés.

## Sources

- Code de commerce, art. L123-12 à L123-28, R123-172 à R123-209 ; Livre des procédures fiscales, art. L47 A, L102 B, A47 A-1 ; Code général des impôts, art. 219, 235 ter ZC, 289 bis, 290, 293 B, annexe II art. 242 nonies A ([codes.droit.org](https://codes.droit.org/), mise à jour d'octobre 2026).
- Règlement ANC n° 2014-03 relatif au plan comptable général, modifié par le règlement n° 2022-06 ([anc.gouv.fr](https://www.anc.gouv.fr/files/anc/files/1_Normes_fran%C3%A7aises/Reglements/2022/R2022_06/R2022_06.pdf)).
- [BOI-CF-IOR-60-40-20](https://bofip.impots.gouv.fr/bofip/9028-PGP.html/identifiant=BOI-CF-IOR-60-40-20-20170607) (FEC) ; [BOI-BIC-DECLA-30-10-20-40](https://bofip.impots.gouv.fr/bofip/2899-PGP.html/identifiant=BOI-BIC-DECLA-30-10-20-40-20180720) (comptabilités informatisées) ; [BOI-TVA-DECLA-30-20-20-20](https://bofip.impots.gouv.fr/bofip/142-PGP.html/identifiant=BOI-TVA-DECLA-30-20-20-20-20220119) (factures rectificatives).
- Facturation électronique : [impots.gouv.fr](https://www.impots.gouv.fr/professionnel/questions/partir-de-quand-suis-je-concerne-par-la-reforme-de-la-facturation).
- Régime simplifié de TVA : [impots.gouv.fr](https://www.impots.gouv.fr/actualite/le-regime-simplifie-dimposition-la-tva-est-supprime-compter-du-1er-janvier-2027).
- Données personnelles : règlement (UE) 2016/679 ; CNIL, [facturation électronique](https://www.cnil.fr/fr/facturation-electronique-quels-enjeux) et référentiel de la gestion des activités commerciales.
