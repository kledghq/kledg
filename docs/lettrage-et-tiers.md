# Lettrage et tiers

Le guide d'utilisation est sur le site : [Lettrer ses comptes clients et fournisseurs](https://www.kledg.com/fr/docs/lettrer-ses-comptes-de-tiers) (lettrer un compte, propositions, balances) et [Les justificatifs](https://www.kledg.com/fr/docs/les-justificatifs) (justificatifs manquants, où trouver la facture, Proposer avec l'IA). Cette page décrit le fonctionnement technique : code, API, règles de calcul, droits et limites d'implémentation.

Le lettrage, la balance auxiliaire, la balance âgée et les justificatifs manquants. Code : `lib/lettering` (règles et service), `lib/reports/third-parties` (balances), `lib/banking/missing-receipts.service.ts`, `lib/companies/payment-terms.service.ts`.

## Lettrage

Page **Saisie, Lettrage** (`/lettering`), API `GET|POST /api/lettering`, `GET /api/lettering/accounts`, `GET /api/lettering/suggestions`, `POST /api/lettering/unletter`, `POST /api/lettering/auto`.

- **Comptes lettrables** : comptes de tiers du PCG (art. 944-40 et 944-46) : clients 41 (411, 413, 416, 4181, 419), fournisseurs 40 (401, 403, 404, 4081, 409), personnel 421 et 425, associés 455, 467 et comptes d'attente 471 à 475 (`LETTERABLE_PREFIXES`, `lib/lettering/rules.ts`). Les comptes à solde courant (TVA 445, organismes sociaux 43, banques 5) ne se lettrent pas.
- **Un groupe est équilibré** : débits égaux aux crédits au centime, au moins deux lignes, un seul compte auxiliaire (une ligne sans compte auxiliaire, un règlement passé au rapprochement par exemple, peut rejoindre le groupe).
- **Pas de lettrage partiel** : une sélection déséquilibrée est refusée (400) avec l'écart. Une facture réglée en plusieurs fois se lettre quand elle est soldée, avec toutes ses lignes. Raison : le FEC n'a qu'un champ `EcritureLet`, sans montant ; les conventions de lettrage partiel (minuscules, codes provisoires) diffèrent d'un logiciel à l'autre et rendraient le solde d'un groupe ambigu. Les codes partiels importés d'un autre logiciel sont gardés tels quels.
- **Codes** : AA, AB... AZ, BA... ZZ, puis AAA, une suite par compte (`nextLetteringCode`) : le code suivant vient après le plus grand code de la suite déjà utilisé sur le compte. La date de lettrage est le jour en France (`parisDayOf`). Les deux vont dans le FEC (`EcritureLet`, `DateLet`, LPF art. A47 A-1) et reviennent à l'import.
- **Écritures validées seulement** : le lettrage ne modifie que `letteringCode` et `letteringDate`, que les déclencheurs d'immuabilité laissent libres (migration 20261003180000) : une écriture validée se lettre. Un brouillon est refusé (409) : il peut encore changer ou être supprimé.
- **Exercice clôturé** : les déclencheurs de verrouillage laissent aussi le lettrage libre sur un exercice clôturé (migration 20261004100000). Kledg le refuse dans son service (409) pour que le FEC d'un exercice clôturé reste celui de la clôture (PCG art. 1031-4, LPF art. L47 A). Aucun déclencheur n'est ajouté : rien d'autre n'écrit le lettrage, et l'import FEC ne vise jamais un exercice clôturé. Les comptes appartiennent à un exercice : un groupe ne chevauche jamais deux exercices, le solde passe dans les à-nouveaux.
- **Concurrence** : chaque écriture de lettrage prend un verrou consultatif par compte, puis relit ses lignes (`FOR UPDATE`) : deux personnes qui lettrent les mêmes lignes obtiennent un lettrage et un 409 ; deux lettrages simultanés d'un compte reçoivent deux codes différents.
- **Lettrage automatique** (`lib/lettering/match.ts`) : propositions toujours équilibrées, dans cet ordre : même tiers et même montant (dates les plus proches d'abord) ; même montant quand une des lignes n'a pas de compte auxiliaire, seulement si la paire est sans ambiguïté ; reste d'un tiers soldé (30 lignes au plus). Les lignes d'une écriture rapprochée avec une transaction bancaire passent en premier (« Rapprochement bancaire ») : c'est ainsi que le rapprochement propose le lettrage du compte 411 ou 401 qu'il solde, une fois l'écriture validée. « Lettrer les propositions » les applique toutes sous le verrou du compte.
- Droits : lecture `entries:read`, lettrage et délettrage `entries:update`. Chaque opération est inscrite au journal d'audit (`LETTER_ENTRY_LINES`, `UNLETTER_ENTRY_LINES`, `AUTO_LETTER_ENTRY_LINES`).

- **Tiers** : le nom d'un tiers enregistré (page Tiers, [factures et tiers](factures-et-tiers.md)) remplace le libellé des lignes de son compte auxiliaire. Les règlements enregistrés sur une facture la lettrent dès qu'ils la soldent.

## Balance auxiliaire

Page **États, Balance auxiliaire**, `GET /api/reports/auxiliary-balance` et son export Excel. Par tiers (compte auxiliaire `CompAuxNum`, sinon le compte lui-même, 411DUPONT par exemple) des comptes 411 et 401, sur une période d'un exercice : solde au début (écriture d'à-nouveaux et lignes antérieures), débit, crédit, solde, et part non lettrée à la fin de la période (une ligne lettrée après la fin compte comme non lettrée). Droit `reports:read` (export : `reports:export`).

## Balance âgée

Page **États, Balance âgée**, `GET /api/reports/aged-balance` et son export Excel, outil MCP `get_aged_balance` (et `get_auxiliary_balance` pour la balance auxiliaire), widget « Créances et dettes échues ».

- Lignes validées des comptes 411 et 401, datées au plus tard le jour de la balance et ouvertes ce jour-là (non lettrées, ou lettrées après).
- **Échéance** d'une facture (débit client, crédit fournisseur) = date de l'écriture + délai de paiement de la société ; un règlement, un avoir ou une avance non lettrés comptent à leur propre date, en déduction.
- **Délai de paiement** (Code de commerce art. L441-10, I) : 30 jours par défaut (al. 1, à défaut d'accord), réglable par société (bouton « Délai de paiement », `PUT /api/companies/[id]/payment-terms`, droit `settings:update`), plafonné à 60 jours à compter de la facture ou à 45 jours fin de mois (al. 2). Les plafonds sont vérifiés à l'enregistrement, par une contrainte de la base et au calcul. « 45 jours fin de mois » se compte en ajoutant les jours à la date de la facture puis en prenant la fin de ce mois (10 janvier + 45 jours = 24 février, échéance le 28 février), la plus courte des deux lectures admises par la DGCCRF.
- **Tranches** : non échu (échéance au jour de la balance ou après), 0 à 30 jours, 31 à 60, 61 à 90, plus de 90 jours de retard.
- Limite : les à-nouveaux portent le solde global de chaque compte. Une ligne d'à-nouveaux sans compte auxiliaire forme un tiers nommé d'après le compte et vieillit à partir du premier jour de l'exercice. Pour une balance âgée exacte en début d'exercice, détaillez l'écriture d'ouverture par compte auxiliaire.

## Justificatifs

Page **Banque, Justificatifs** (`/banking/missing-receipts`), `GET /api/banking/missing-receipts`, outil MCP `list_missing_receipts`, droit `banking:read`.

Transactions bancaires sans pièce jointe, d'un montant au moins égal au seuil choisi (retenu dans le navigateur), filtrables par exercice, compte bancaire et sens ; les opérations refusées par la banque sont exclues. Chaque écriture s'appuie sur une pièce justificative, conservée dix ans (Code de commerce art. L123-22). Kledg reçoit les justificatifs de la banque (Qonto) : déposez la pièce dans la banque puis « Synchroniser les justificatifs ». Chaque ligne mène à la liste des transactions filtrée sur l'opération (`/transactions?bankAccountId=&startDate=&endDate=&hasAttachments=without&search=`).

### Où trouver la facture

Chaque opération affiche le fournisseur reconnu dans son libellé ou sa contrepartie, rien quand aucun n'est reconnu :

- **Fournisseur connu** (`lib/receipts/vendors.ts`) : OVHcloud, Google Cloud et Workspace, Microsoft 365 et Azure, AWS, Adobe, Apple, Notion, Slack, Zoom, Canva, OpenAI, Anthropic, GitHub, Vercel, Netlify, Free et Free Mobile, Orange, SFR, Bouygues Telecom, EDF, Engie, TotalEnergies (électricité et gaz), SNCF Connect, Uber, Air France, Booking.com, Amazon.fr, La Poste, Qonto, Shine, Stripe, PayPal. Le motif de libellé vient du modèle de la [bibliothèque de règles](bibliotheque-de-regles.md) quand il en existe un pour ce seul fournisseur, sinon il est propre au fournisseur (même moteur d'expressions régulières, en temps linéaire). Le lien « Où trouver la facture » (nouvel onglet) mène à la page officielle où le client télécharge ses factures, connexion requise ; il n'existe que si l'aide officielle du fournisseur donne cette page, citée dans le champ `source`. Sans page vérifiée (Notion, Netlify, Air France, Booking.com, Qonto, Shine, PayPal), le fournisseur est affiché sans lien.
- **Tiers de la société** : sinon, le fournisseur (pour une dépense) ou le client (pour une recette) dont le nom, sans forme juridique en tête ou en fin (SAS, SARL, SCI...), ou le compte auxiliaire alphabétique apparaît en mots entiers dans le libellé ; le nom le plus long l'emporte.

L'outil MCP `list_missing_receipts` renvoie pour chaque opération `supplier` (`name`, `recognisedBy` : `vendor` ou `tiers`, `tiersId`, `invoicesUrl`) et `bank` (fournisseur bancaire, `QONTO` pour joindre la pièce avec `upload_receipt`).

« Proposer avec l'IA » prépare une demande pour l'assistant : identifier le fournisseur (donné quand il est reconnu) et la facture attendue (datée du 10e jour avant au 5e jour après l'opération, du montant TTC), la chercher dans les outils de messagerie et de fichiers de l'utilisateur auxquels l'assistant a accès (Gmail, Outlook, Google Drive, OneDrive...), puis, s'il la trouve, dire ce qu'il a trouvé et la joindre avec `upload_receipt` sur un compte Qonto, ou sinon donner le fichier et ses détails ; s'il ne la trouve pas, indiquer la page des factures du fournisseur quand elle est connue. **Kledg n'accède jamais à vos mails ni à vos fichiers** : seule la recherche de l'assistant, avec les connecteurs que vous lui avez donnés, les lit.
