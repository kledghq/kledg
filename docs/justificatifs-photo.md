# Justificatifs photographiés (assistants et page Justificatifs)

Le guide d'utilisation (photo dans Claude ou ChatGPT, rattachement, note de frais, page Justificatifs) est sur le site : [Classer ses justificatifs en photo](https://www.kledg.com/fr/docs/classer-ses-justificatifs-en-photo), et la page Justificatifs elle-même dans [Les justificatifs](https://www.kledg.com/fr/docs/les-justificatifs). Cette page décrit le fonctionnement technique : outils MCP, routes, rapprochement, droits, stockage, limites et sécurité.

Prendre en photo un ticket ou une facture dans Claude ou ChatGPT, et le retrouver dans Kledg sur la bonne transaction bancaire ; si aucune transaction ne correspond, Kledg propose une note de frais et la prépare en brouillon. La page **Justificatifs** fait la même chose sans assistant, avec la zone **Déposer des justificatifs**.

Kledg n'appelle aucun modèle : ce sont les assistants qui lisent la photo (montant, date, commerçant, TVA). Dans Kledg, l'utilisateur confirme ces champs dans un petit formulaire prérempli à partir du nom du fichier quand c'est possible.

## Parcours

```
photo ──▶ justificatif déposé (staged) ──▶ recherche de la transaction
                                              ├─ matched     ─▶ rattacher (attach)
                                              ├─ candidates  ─▶ l'utilisateur choisit ─▶ rattacher
                                              └─ none        ─▶ « Est-ce une note de frais ? » ─▶ oui ─▶ note de frais en brouillon (expense)
```

1. **Dépôt** (`stage_receipt`, `POST /api/receipts/staged`) : trois entrées mènent au même justificatif déposé.
   - La **vue de dépôt** (`capture_receipt`, modèle MCP Apps `ui://kledg/receipt-capture.v1.html`) : bouton « Prendre une photo » (`accept="image/*"`, `capture="environment"`) et « Choisir un fichier » (image ou PDF). Une photo trop lourde, ou dans un autre format que JPEG ou PNG (HEIC d'un iPhone), est décodée dans la vue (`createImageBitmap`), redessinée sur un canvas et envoyée en JPEG de 2000 pixels au plus, qualité réduite jusqu'à passer sous 5 Mo. La vue appelle `stage_receipt` (base64, `from: capture_view`) avec le montant et la date, préremplis par l'assistant ou saisis.
   - Un **fichier joint dans ChatGPT** : `stage_receipt` déclare `_meta["openai/fileParams"] = ["file"]` ; ChatGPT passe `{ download_url, file_id, mime_type?, file_name? }` et Kledg télécharge le fichier côté serveur (voir [Sécurité](#sécurité)).
   - Le **base64** pour les clients qui savent envoyer des octets.
   - La page **Justificatifs** (plusieurs fichiers, glisser-déposer, appareil photo du téléphone), avec la même réduction côté navigateur.
2. **Recherche** (`file_receipt` action `match`, `POST /api/receipts/staged/[id]/match`) : les champs lus sont enregistrés sur le justificatif, puis les débits de la société sont notés (`lib/receipts/match-receipt.ts`, module pur, testé) :
   - montant TTC égal au centime près ; pour une devise étrangère, le montant d'origine de la transaction quand la banque le donne (`local_amount` de Qonto), sinon pas de correspondance de montant ;
   - date de la transaction de 3 jours avant à 10 jours après celle du ticket (un paiement par carte est débité quelques jours plus tard) ;
   - commerçant : les mots du nom lu contre le libellé, la contrepartie et le fournisseur que Kledg y reconnaît (fournisseur connu de `lib/receipts/vendors.ts`, tiers fournisseur de la société) ;
   - jamais une transaction qui a déjà un justificatif, ni un crédit, ni une opération refusée.
   Résultat : `matched` (une transaction avec le montant, score d'au moins 0,75 et 0,15 d'avance sur la suivante), `candidates` (5 au plus, notées, avec leurs raisons) ou `none`. Un ticket payé avec une carte personnelle ou en espèces (`paymentMethod`) n'est jamais rattaché à la banque : `none`, raison `personal_payment`.
3. **Rattachement** (`file_receipt` action `attach`, `POST /api/receipts/staged/[id]/attach`) :
   - compte **Qonto** : le fichier part sur la transaction chez Qonto par le chemin existant (`uploadQontoReceipt`, celui de `upload_receipt` et du mode simple), dans la limite d'appels bancaires de la société, avec une clé d'idempotence dérivée du justificatif et de la transaction ; Qonto le renvoie à la synchronisation et Kledg supprime sa copie ;
   - **autre banque** (sans API de justificatifs) : Kledg garde le fichier et crée une pièce jointe de la transaction (`attachments.receiptFileId`) : la page Justificatifs la compte comme fournie, le proxy des justificatifs (`GET /api/banking/attachments/[id]/proxy`, `get_file` source `bank_receipt`) sert le fichier sans appel à la banque.
4. **Note de frais** (`file_receipt` action `expense`, `POST /api/receipts/staged/[id]/expense`), seulement après que l'utilisateur a répondu oui : une ligne préremplie (date, commerçant, montant TTC, une ligne par taux de TVA lu, catégorie donnée par les règles de mots-clés de la société, sinon « Autre dépense », justificatif joint comme ticket) est ajoutée au brouillon de l'utilisateur qui couvre ce jour, sinon à un nouveau brouillon du mois. Si ce brouillon ne peut pas prendre la ligne (une de ses lignes est à corriger), un nouveau brouillon du mois est créé. La note n'est jamais soumise ni validée : l'utilisateur la vérifie et la soumet dans Kledg. Un ticket dans une autre devise demande le montant débité en euros.

`file_receipt` action `discard` (`DELETE /api/receipts/staged/[id]`) abandonne un justificatif déposé par erreur.

Chaque résultat de `capture_receipt`, `stage_receipt` et `file_receipt` porte les données de la vue (`structuredContent`, `lib/mcp/views/receipt.ts`) : correspondance trouvée, candidates avec un bouton « Rattacher », proposition de note de frais avec « Créer la note de frais », aperçu à approuver, puis lien vers l'élément dans Kledg. Chaque bouton rappelle ces mêmes outils.

## Droits et approbation

| Action | Outil | Route | Droit |
| --- | --- | --- | --- |
| Ouvrir la vue de dépôt | `capture_receipt` | | `expenses:submit` |
| Déposer | `stage_receipt` | `POST /api/receipts/staged` | `expenses:submit` |
| Lister ses justificatifs en attente | | `GET /api/receipts/staged` | `expenses:submit` |
| Rechercher la transaction | `file_receipt` `match` | `POST .../match` | `banking:read` |
| Rattacher | `file_receipt` `attach` | `POST .../attach` | `banking:reconcile` |
| Note de frais | `file_receipt` `expense` | `POST .../expense` | `expenses:submit` |
| Abandonner | `file_receipt` `discard` | `DELETE /api/receipts/staged/[id]` | `expenses:submit` |

- Les trois outils sont de niveau brouillons (`kledg:write`), déclarés avec `fullControlTool` et `level: 'write'` (`lib/mcp/full-control/receipts.ts`, enregistrés par `lib/mcp/receipts-tools.ts`). Les droits sont vérifiés par `guard.require`, comme les outils de brouillons, et les appels comptent dans la limite des écritures de brouillons.
- **Rattacher** agit hors des brouillons (chez Qonto, sans retour possible, ou un justificatif compté comme fourni) : c'est une action à fort impact. Sur une connexion de niveau brouillons, elle attend toujours l'approbation de l'utilisateur dans Kledg (aperçu, `actionId`, page d'approbation), même si la connexion est en mode automatique ; avec le contrôle total, elle suit le mode d'exécution de la connexion (`dryRun` puis exécution en mode automatique). L'approbation couvre le justificatif et la transaction (`targetState` : verrou de la société, lignes `staged_receipts` et `bank_transactions`) : une modification après l'approbation fait refuser l'exécution.
- Un membre voit les justificatifs qu'il a déposés ; un membre qui rapproche la banque ou valide les notes de frais voit ceux de toute la société. Ceux d'un autre membre, ou d'une autre société, sont « introuvables ».
- Journal d'audit : `RECEIPT_STAGED`, `RECEIPT_ATTACHED`, `RECEIPT_EXPENSE`, `RECEIPT_DISCARDED`, `RECEIPT_STORED_AT_QONTO`, plus les entrées MCP habituelles (`MCP_FULL_CONTROL`, `MCP_FULL_CONTROL_PENDING`).

## Stockage

- `receipt_files` : un justificatif que Kledg garde (JPEG, PNG ou PDF, 5 Mo au plus, une ligne par contenu dans une société, SHA-256). Ses octets sont dans le stockage configuré (`storageDriver` : Vercel Blob privé, S3, dossier du serveur, ou la base dans `content` quand rien n'est configuré) sous la clé `storageKey`, `receipts/<société>/<aléatoire>` ; voir [configuration.md](configuration.md#stockage-des-justificatifs). Contraintes en base : type, taille, empreinte, octets à un seul endroit, clé dans le préfixe de la société. Chaque lecture vérifie la taille et le SHA-256 (`lib/receipts/receipt-file-store.ts`).
- `staged_receipts` : le justificatif déposé, son fichier, son empreinte, qui l'a déposé, d'où (`view`, `file_param`, `base64`, `app`), les champs lus, son statut (`staged`, `attached`, `expense`, `discarded`) et où il est allé (transaction, pièce jointe, note de frais).
- Les deux tables ont la sécurité au niveau des lignes (politiques `kledg_rls_*` sur `companyId`, [rls.md](rls.md)).
- Un justificatif non classé (`staged` ou `discarded`) expire 30 jours après son dépôt : il est supprimé avec son fichier et l'objet stocké au dépôt suivant d'un justificatif de la société (`purgeExpiredReceipts`), sans tâche planifiée. Abandonner un justificatif, l'envoyer à Qonto ou supprimer la société supprime aussi l'objet. Le fichier d'un justificatif rattaché à une autre banque ou joint à une note de frais reste, comme toute pièce justificative (Code de commerce art. L123-22 : conservation dix ans).
- Le même fichier déposé deux fois dans une société donne le même justificatif : un dépôt répété ne classe rien deux fois, et un justificatif déjà rattaché répond où il est.

Migrations : `20261201090000_receipt_capture`, `20261202090000_receipt_object_storage` (additives). Les fichiers gardés dans la base avant le stockage d'objets se déplacent avec `pnpm receipts:migrate-storage` ([configuration.md](configuration.md#déplacer-les-justificatifs-existants)).

## Qonto

Vérifié le 2026-10-08 dans la référence de l'API Business de Qonto (les pages n'ont ni date ni journal des modifications) :

| Besoin | Point d'accès | Clé API | Utilisé |
| --- | --- | --- | --- |
| Justificatif d'une transaction Qonto | `POST /v2/transactions/{id}/attachments` ([doc](https://docs.qonto.com/api-reference/business-api/expense-management/attachments-in-transactions/upload-an-attachment-to-a-transaction)) | oui | oui, au rattachement |
| Fichier sans transaction, relisible | `POST /v2/supplier_invoices/bulk` ([doc](https://docs.qonto.com/api-reference/business-api/expense-management/supplier-invoices/create-supplier-invoices)), relu par `GET /v2/supplier_invoices/{id}` ([doc](https://docs.qonto.com/api-reference/business-api/expense-management/supplier-invoices/retrieve-a-supplier-invoice)) puis `GET /v2/attachments/{id}` | oui (tableau *Endpoints access* de [l'introduction à l'authentification](https://docs.qonto.com/get-started/business-api/authentication/introduction)) | sur option, voir ci-dessous |
| Pièce jointe isolée | `POST /v2/attachments` ([doc](https://docs.qonto.com/api-reference/business-api/expense-management/attachments/upload-an-attachment)) | oui | non : la référence ne dit pas combien de temps Qonto garde une pièce reliée à rien |
| Demande de remboursement, note de frais, boîte de réception des justificatifs | aucun ; `/v2/requests` ne crée que des demandes de virement ou de carte, par OAuth seulement | | non |
| Supprimer une facture fournisseur | aucun (liste, création, lecture, refus, payée ou non payée) | | |

Ce que Qonto permet est déclaré à un seul endroit, `QONTO_RECEIPT_CAPABILITIES` (`lib/integrations/providers/qonto/capabilities.ts`) : `storesTransactionReceipts`, `canStoreUnmatchedReceipts` (factures fournisseurs), `canStoreExpenseReports` (`false`).

**Justificatifs des notes de frais envoyés à Qonto** (`lib/receipts/offload-to-qonto.service.ts`), désactivé par défaut, activé par l'exploitant avec `KLEDG_QONTO_EXPENSE_RECEIPTS=supplier_invoices` : Qonto range le fichier parmi les factures fournisseurs « à vérifier » (quelqu'un pourrait le prendre pour une facture à payer) et n'a aucun moyen de le supprimer. Activé, pour une société connectée à Qonto :

1. seul le justificatif d'une ligne d'une note de frais **validée** part (un brouillon peut encore perdre la ligne) ;
2. envoi par `POST /v2/supplier_invoices/bulk`, sans rapprochement automatique de Qonto (`skip_attachment_matcher`, un paiement personnel n'a pas de transaction), avec une clé d'idempotence dérivée de la société et du SHA-256 du fichier ; la réponse 200 peut porter une erreur par facture (`errors`), lue comme un refus ;
3. relecture : la facture, sa pièce (`attachment_id`), puis le fichier, dont le SHA-256 doit être celui envoyé ;
4. seulement alors, la pièce jointe de Kledg pointe vers la pièce de Qonto (`externalAttachmentId`, `providerData.qontoSupplierInvoiceId`) et Kledg supprime sa copie. Le proxy des justificatifs lit ensuite le fichier chez Qonto. Un refus, un fichier pas encore lisible ou différent laisse la copie de Kledg ; l'essai suivant recommence.

L'envoi a lieu après la synchronisation bancaire quotidienne de la société (20 justificatifs au plus, dans la limite d'appels bancaires) et avec `pnpm receipts:migrate-storage --qonto`. Journal d'audit : `RECEIPT_STORED_AT_QONTO`.

## Limites

| Limite | Valeur |
| --- | --- |
| Taille d'un fichier | 5 Mo après réduction (`RECEIPT_MAX_BYTES`) |
| Formats | JPEG, PNG, PDF, lus sur les premiers octets ; HEIC refusé côté serveur (la vue et la page le convertissent quand le navigateur sait le lire) |
| Dépôts | 60 par 10 minutes et par utilisateur (`receipt-upload`) |
| Rattachement Qonto | limite d'appels bancaires de la société (`bank-api`) |
| Fenêtre de recherche | de 3 jours avant à 10 jours après la date du ticket, 500 transactions au plus |
| Candidates | 5 au plus |
| Conservation d'un justificatif non classé | 30 jours |

## Sécurité

- Type lu sur les octets (`lib/receipts/file-type.ts`) : jamais le nom ni le type annoncé. Le nom est nettoyé (pas de chemin, pas de caractère de contrôle ou invisible) et prend l'extension du vrai type.
- Fichiers de ChatGPT (`lib/receipts/openai-file.ts`) : l'URL vient des arguments de l'outil, donc n'est pas sûre. Kledg ne la télécharge que si elle est en https sur le port par défaut, sans identifiants ni adresse IP, sur un hôte de fichiers d'OpenAI (`*.oaiusercontent.com` ; l'exploitant peut ajouter des noms exacts avec `KLEDG_OPENAI_FILE_HOSTS`). La connexion ne s'ouvre que vers une adresse publique, vérifiée à l'ouverture de la socket (`publicFetch`, contre le rebinding DNS), sans suivre de redirection, avec un délai de 20 secondes et un budget de 5 Mo coupé pendant la lecture.
- Vue de dépôt : modèle autonome (CSP stricte, aucune URL, aucun accès réseau, aucune analyse HTML des données), messages envoyés au seul hôte une fois la poignée de main faite et messages d'une autre origine ignorés ([mcp-views.md](mcp-views.md)). La photo ne quitte la vue que par `tools/call`, vérifié par le serveur comme un appel de l'assistant.
- Un texte lu sur un ticket (nom de commerçant) est une donnée : les outils ne l'interprètent jamais comme une instruction, et l'assistant pose la question de la note de frais à l'utilisateur.

## Code

| Fichier | Rôle |
| --- | --- |
| `lib/receipts/file-type.ts` | Type par les octets, nom de fichier, limites (pur) |
| `lib/receipts/match-receipt.ts` | Notation des transactions (pur) |
| `lib/receipts/file-name-fields.ts` | Date, montant et commerçant d'un nom de fichier (pur, client) |
| `lib/receipts/openai-file.ts` | Téléchargement protégé des fichiers de ChatGPT |
| `lib/receipts/stage-receipt.service.ts` | Dépôt, déduplication, expiration, abandon |
| `lib/receipts/file-receipt.service.ts` | Recherche, rattachement, note de frais |
| `lib/receipts/receipt-file-store.ts` | Octets des justificatifs dans le stockage configuré, vérification du SHA-256, suppression des objets |
| `lib/storage/**` | Pilotes de stockage d'objets (Vercel Blob privé, S3, dossier) et choix par l'environnement |
| `lib/receipts/migrate-receipt-storage.service.ts`, `scripts/migrate-receipt-storage.ts` | `pnpm receipts:migrate-storage` |
| `lib/receipts/offload-to-qonto.service.ts`, `lib/integrations/providers/qonto/supplier-invoices.ts`, `lib/integrations/providers/qonto/capabilities.ts` | Justificatifs des notes de frais envoyés à Qonto |
| `lib/mcp/full-control/receipts.ts` | Outils `capture_receipt`, `stage_receipt`, `file_receipt` |
| `lib/mcp/views/receipt.ts`, `lib/mcp/views/html/receipt.ts` | Données et modèle de la vue `receipt-capture` |
| `app/api/receipts/staged/**` | Routes de la page Justificatifs |
| `components/features/receipts/receipt-drop-zone.tsx` | Zone « Déposer des justificatifs » |

Tests : `lib/receipts/__tests__` (notation, octets, noms, SSRF, services contre PostgreSQL ; `receipt-storage.db.test.ts` : stockage d'objets, suppression des objets, déplacement, envoi à Qonto), `lib/storage/__tests__/drivers.test.ts` (contrat des pilotes), `lib/integrations/providers/qonto/__tests__/supplier-invoices.test.ts`, `lib/mcp/__tests__/receipt-tools.db.test.ts` (outils par `/api/mcp`, approbation), `lib/mcp/__tests__/views.test.ts` (vue : origine, envoi, rattachement, note de frais), `app/api/__tests__/receipt-routes.db.test.ts`, `components/features/receipts/__tests__/receipt-drop-zone.test.tsx`, matrice des autorisations.
