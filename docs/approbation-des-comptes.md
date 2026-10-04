# Approbation des comptes et dépôt au greffe

Après la clôture, les associés approuvent les comptes de l'exercice et décident de l'affectation du résultat, puis la société dépose les comptes au greffe. Kledg prépare les documents de cette étape selon la forme juridique de la société, à partir des écritures, des informations de la société et de ses associés, et de ce que l'utilisateur renseigne. Code : `lib/approval` ; page Saisie, Approbation des comptes (`/approval`) ; routes `GET` et `PUT /api/companies/[id]/fiscal-years/[fiscalYearId]/approval`, `GET .../approval/documents/[document]?format=pdf|md` ; outil MCP `get_year_end_formalities`.

Kledg n'invente rien : une donnée que la loi exige et que Kledg ne connaît pas (ville du greffe, date et lieu de l'assemblée, présence et votes, dividendes des trois exercices précédents...) est demandée dans le formulaire, et chaque document liste ce qui lui manque. Un document ne se génère que lorsque rien ne lui manque. Ces documents ont une portée juridique : faites-les relire par votre expert-comptable ou votre conseil.

Textes vérifiés le 4 octobre 2026 sur la version consolidée du Code de commerce et du Code civil (données Légifrance du 1er octobre 2026).

## Selon la forme juridique

| Forme | Qui décide | Dirigeant | Délai d'approbation | Majorité | Registre | Dépôt au greffe |
|---|---|---|---|---|---|---|
| SARL, SELARL | Assemblée générale ordinaire des associés, ou consultation écrite si les statuts la prévoient (C. com. art. L223-26, L223-27) | gérant | six mois après la clôture, prolongation par ordonnance du président du tribunal de commerce (L223-26) | plus de la moitié des parts sociales ; sur deuxième consultation, majorité des votes émis, sauf clause des statuts (L223-29) | procès-verbaux, registre coté et paraphé (R223-24, R221-3) | oui (L232-22) |
| EURL | L'associé unique, seul (L223-31) | gérant | six mois (L223-31) | décision de l'associé unique | registre des décisions (L223-31, R223-26) | oui (L232-22) |
| SAS, SELAS | La collectivité des associés, dans les formes des statuts (L227-9) | président | aucun délai légal pour une SAS pluripersonnelle : L227-1 exclut L225-100 des règles de la SA applicables ; celui des statuts, six mois le plus souvent | celle des statuts (L227-9) | registre prévu par les statuts | oui (L232-23) |
| SASU | L'associé unique (L227-9) | président, jamais un gérant | six mois (L227-9) | décision de l'associé unique | registre des décisions (L227-9) | oui (L232-23) |
| SA (conseil d'administration) | Assemblée générale ordinaire des actionnaires (L225-100) | président du conseil d'administration | six mois, prolongation par décision de justice (L225-100) | quorum du cinquième des actions ayant le droit de vote sur première convocation, aucun sur deuxième ; majorité des voix exprimées, sans les abstentions (L225-98) | registre spécial (R225-106) | oui (L232-23) |
| SCI | Les associés, dans les conditions des statuts, à l'unanimité à défaut (C. civ. art. 1852, 1853) | gérant | au moins une fois par an (C. civ. art. 1856) | celle des statuts, unanimité à défaut (C. civ. art. 1852) | registre des procès-verbaux | non : une société civile ne dépose pas ses comptes |

- Une SARL ou une SAS dont un seul associé est enregistré suit les règles de l'associé unique (EURL, SASU), quelle que soit la forme choisie : la page le signale.
- Dans une SARL, les associés qui participent à distance ne sont pas comptés pour l'approbation des comptes (L223-27) : la page le rappelle quand un associé est noté « à distance ».
- Dépôt valant approbation : dans une EURL dont l'associé unique est le seul gérant, et dans une SASU dont l'associé unique, personne physique, est le président, le dépôt au greffe de l'inventaire et des comptes annuels signés dans les six mois vaut approbation, sans inscrire le récépissé au registre (L223-31, L227-9). La décision d'affectation du résultat reste à déposer (L232-22, L232-23) : Kledg prépare la décision de l'associé unique dans tous les cas.
- SNC, SCS, SCA et entrepreneur individuel ne sont pas pris en charge : la page le dit au lieu de deviner.

## Les documents

| Document | Quand | Contenu |
|---|---|---|
| Convocation, ou lettre de consultation écrite | Assemblée ou consultation écrite, jamais pour un associé unique | Date, heure, lieu, ordre du jour, pièces jointes (comptes annuels, rapport de gestion s'il est établi, rapport du commissaire aux comptes, texte des projets de résolutions), les projets de résolutions. SARL : lettre recommandée quinze jours avant au moins, inventaire tenu au siège pendant ces quinze jours (R223-18, R223-20) ; SA : quinze jours sur première convocation (R225-69) ; SCI : quinze jours, lettre recommandée (décret n° 78-704, art. 40 et 41) ; SAS : selon les statuts. La page indique la date limite d'envoi et signale une convocation tardive. |
| Rapport de gestion | Obligatoire sauf dispense, ou à la demande | Activité et situation, résultats (chiffre d'affaires et résultat lus dans les écritures), événements importants depuis la clôture, recherche et développement, évolution prévisible (L232-1 II), proposition d'affectation, dividendes des trois exercices précédents (CGI art. 243 bis), dépenses non déductibles (CGI art. 223 quater). Pour une SCI : rapport écrit de la gérance (C. civ. art. 1856). |
| Procès-verbal, ou décision de l'associé unique | Toujours | Date, lieu, associés présents ou représentés avec leurs titres, règle de quorum et de majorité, ordre du jour, documents présentés, texte de chaque résolution et résultat du vote (R223-24 pour la SARL, R225-106 pour la SA) ; pour un associé unique, décision consignée au registre. |
| Feuille de présence | Assemblée (obligatoire dans une SA, R225-95 ; utile ailleurs pour établir le quorum et la majorité) | Associés, titres, présence ou représentation, colonne de signature, certification du bureau. |
| Déclaration de confidentialité, ou de publication simplifiée | Option choisie au dépôt | Catégorie de la société, exclusions, demande de non-publication (L232-25, R123-111-1). Le guichet unique propose le modèle fixé par arrêté : ce document en reprend les éléments. |
| Liste du dépôt au greffe | Sociétés commerciales | Pièces, délai, canal, sanction. |

Chaque document se télécharge en **PDF** (à signer) ou en **Markdown** (texte modifiable dans n'importe quel éditeur, ou à coller dans un traitement de texte). Les deux formats viennent du même contenu (`lib/approval/documents`).

### Les résolutions

1. **Approbation des comptes** tels qu'arrêtés par la gérance, le président ou le conseil d'administration (L232-1), avec le résultat de l'exercice. Pour une société à l'impôt sur les sociétés, l'approbation des dépenses non déductibles de l'article 39, 4 du CGI, ou le constat qu'il n'y en a pas (CGI art. 223 quater), quand le montant est renseigné.
2. **Conventions réglementées** : SARL (L223-19), SAS (L227-10), SA (L225-38 à L225-40). Dans une SARL et une SA, les associés ou actionnaires intéressés ne votent pas. Pour un associé unique, seulement quand des conventions ont été conclues : elles sont mentionnées au registre des décisions.
3. **Affectation du résultat** : celle que Kledg comptabilise ensuite (`lib/accounting/result-allocation`) : réserve légale d'un vingtième du bénéfice diminué des pertes antérieures, jusqu'au dixième du capital (L232-10, SARL et sociétés par actions), dividendes dans la limite du bénéfice distribuable (L232-11), autres réserves, apurement du report à nouveau débiteur, report à nouveau. Une perte va au report à nouveau. Mise en paiement des dividendes dans les neuf mois de la clôture (L232-13). Rappel des dividendes des trois exercices précédents (CGI art. 243 bis) pour une société à l'impôt sur les sociétés.
4. **Pouvoirs pour les formalités**.

Pas de résolution de **quitus** : aucune décision des associés ne peut éteindre une action en responsabilité contre les dirigeants (L223-22 pour la SARL, L225-253 pour la SA), elle n'aurait donc pas l'effet que son nom suggère.

### Votes

Une voix par part ou par action (les droits de vote double ne sont pas modélisés : saisissez les voix exprimées). Pour chaque résolution, l'utilisateur coche « à l'unanimité des présents et représentés » ou saisit les voix pour, contre et les abstentions ; Kledg applique la règle de la forme (tableau ci-dessus) et écrit « adoptée » ou « rejetée » avec le détail. Une SAS demande la règle de ses statuts (majorité, voix comptées, quorum, article) ; une SCI applique l'unanimité quand les statuts ne disent rien. Si l'approbation est rejetée, la délibération de refus se dépose au greffe dans le même délai (L232-22 II, L232-23 II).

## Taille de la société

La catégorie décide de la dispense de rapport de gestion et des options de confidentialité. Seuils du décret n° 2024-152 (C. com. art. D123-200 et D230-1), pour les exercices ouverts depuis le 1er janvier 2024 :

| Catégorie | Total du bilan | Chiffre d'affaires net | Effectif moyen |
|---|---|---|---|
| Micro-entreprise | 450 000 € | 900 000 € | 10 |
| Petite entreprise | 7 500 000 € | 15 000 000 € | 50 |
| Moyenne entreprise | 25 000 000 € | 50 000 000 € | 250 |

Une société relève d'une catégorie quand elle ne dépasse pas deux des trois seuils ; un changement de catégorie ne compte que sur deux exercices consécutifs (L123-16, L123-16-1, D230-1). Kledg lit le total du bilan et le chiffre d'affaires (comptes 70) de l'exercice et du précédent dans les écritures validées, demande l'effectif, propose une catégorie (la plus élevée des deux exercices quand ils diffèrent) et laisse l'utilisateur la confirmer.

- **Rapport de gestion** : les sociétés commerciales micro et petites en sont dispensées (L232-1 IV), sauf les entités de l'article L123-16-2 (établissements de crédit, assurances, sociétés cotées, organismes faisant appel à la générosité publique) et les sociétés dont l'activité consiste à gérer des titres de participations ou des valeurs mobilières (case « holding » des informations de la société). Une SCI établit toujours un rapport écrit (C. civ. art. 1856). Une SA établit aussi le rapport sur le gouvernement d'entreprise (L225-37), que Kledg ne génère pas.
- **Confidentialité au dépôt** (L232-25) : une micro-entreprise peut demander que ses comptes annuels ne soient pas rendus publics (pas pour une entité de L123-16-2 ni une société de gestion de titres) ; une petite entreprise, que son compte de résultat ne le soit pas ; une moyenne entreprise, que son bilan et son annexe soient publiés sous une forme simplifiée (pas pour une entité de L123-16-2 ni une société d'un groupe au sens de L233-16). Les comptes restent communiqués aux autorités judiciaires et administratives et à la Banque de France.

## Dépôt au greffe et échéances

Une société commerciale dépose, dans le mois qui suit l'approbation, ou dans les deux mois en cas de dépôt par voie électronique (L232-22 pour la SARL et l'EURL, L232-23 pour la SA, la SAS et la SASU) :

- les comptes annuels (bilan, compte de résultat, annexe ; une micro-entreprise peut ne pas établir d'annexe, L123-16-1) ;
- la proposition d'affectation du résultat et la résolution ou la décision votée ;
- le rapport du commissaire aux comptes s'il y en a un ;
- la déclaration de confidentialité si l'option est choisie ;
- en cas de refus d'approbation, une copie de la délibération.

Le rapport de gestion n'est pas déposé (sauf sociétés cotées) : il est tenu à la disposition de qui le demande. Le dépôt se fait sur le guichet unique des formalités des entreprises (formalites.entreprises.gouv.fr) ; des frais de greffe s'appliquent. Un défaut de dépôt est une contravention de la cinquième classe (R247-3) et peut donner lieu à une injonction sous astreinte (L123-5-1).

Les échéances d'approbation et de dépôt restent calculées par le calendrier des échéances (`lib/deadlines`, page Échéances), sans doublon : la page d'approbation appelle les mêmes fonctions (`approvalDeadlineOf`, `filingDeadlineOf`). Quand la date d'approbation est enregistrée, le calendrier compte le dépôt depuis cette date au lieu de la date limite d'approbation, et note les dates d'approbation et de dépôt enregistrées. Le choix « dépôt en ligne » de la page d'approbation prend le pas, pour l'exercice, sur le réglage de la carte Échéances.

## Données et droits

- Lecture (`reports:read`) : tous les membres. Enregistrement (`closing:execute`) : administrateur de la société et comptable. Téléchargement des documents (`reports:export`), limité comme les autres exports.
- Une ligne par exercice dans `accounts_approvals` (migration `20261028090000_accounts_approvals`) : les données saisies en JSON, validées par `ApprovalDetailsSchema` (`lib/approval/schemas.ts`) à chaque écriture, et les dates d'approbation et de dépôt en colonnes pour le calendrier. La clé étrangère composée garde l'exercice dans la société de la ligne ; la base refuse une date de dépôt antérieure à l'approbation. Sécurité au niveau des lignes : table de société, politiques `kledg_rls_*` sur `companyId` ([rls.md](rls.md)).
- Les associés et leurs titres viennent de la composition du capital, les dirigeants se choisissent parmi les personnes et les associés de la société ou se saisissent. Seuls les noms sont utilisés : dates de naissance et adresses des personnes restent sur leur fiche. L'enregistrement est journalisé (`SAVE_ACCOUNTS_APPROVAL`).
- Le résultat est celui des écritures validées de l'exercice, sans l'écriture de clôture ; les réserves, le capital et le report à nouveau sont ceux d'avant l'affectation de l'exercice. La page signale un exercice non clôturé, des brouillons, et un résultat de l'exercice précédent pas encore affecté.

## Ce que Kledg ne fait pas

- Le tableau des délais de paiement du rapport de gestion d'une société dont les comptes sont certifiés (L441-14, D441-6), le rapport sur le gouvernement d'entreprise d'une SA, les comptes consolidés.
- Les SA à directoire, les SNC, SCS et SCA, les assemblées extraordinaires.
- La signature électronique et le dépôt lui-même sur le guichet unique.
- La mention de l'éligibilité des dividendes antérieurs à l'abattement de 40 % (CGI art. 243 bis) : à compléter dans le texte Markdown si nécessaire.
