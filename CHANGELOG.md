# Changelog

Toutes les évolutions notables de Kledg sont consignées ici. Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet respecte le [versionnage sémantique](https://semver.org/lang/fr/).

## [Non publié]

### Ajouté

- **Lettrage** des comptes de tiers (Saisie, Lettrage) : par compte et par tiers, les lignes non lettrées avec leur solde progressif ; une sélection dont les débits égalent les crédits reçoit le code suivant du compte (AA, AB...) et la date du jour, repris dans le FEC (`EcritureLet`, `DateLet`) et relus à l'import. Délettrage, propositions de lettrage automatique (même tiers et même montant, règlements rapprochés avec la banque en premier). Pas de lettrage partiel, ni de lettrage dans un exercice clôturé. Voir [docs/lettrage-et-tiers.md](docs/lettrage-et-tiers.md).
- **Balance auxiliaire** et **balance âgée** (États), avec export Excel : soldes par client et fournisseur, part non lettrée, créances et dettes par ancienneté de l'échéance (non échu, 0 à 30, 31 à 60, 61 à 90, plus de 90 jours). Le délai de paiement se règle par société : 30 jours par défaut, au plus 60 jours ou 45 jours fin de mois (Code de commerce, art. L441-10).
- **Justificatifs manquants** (Banque) : les opérations bancaires sans pièce justificative au-dessus d'un seuil, par exercice et par compte, avec un lien vers la transaction (Code de commerce, art. L123-22).
- Widget « Créances et dettes échues » au tableau de bord ; outils MCP `get_aged_balance`, `list_missing_receipts` et, en contrôle total, `list_unlettered_lines`, `letter_entry_lines`, `unletter_entry_lines`. La liste des transactions accepte ses filtres dans l'adresse.

## [0.1.0] - 2026-10-04

Première version publique.

### Ajouté

- Comptabilité générale PCG 2026 : sociétés et établissements, membres et rôles, exercices avec clôture et à-nouveaux, plan de comptes, journaux, écritures avec contrôles PCG.
- Import FEC, CSV et Excel ; export FEC.
- Banque : import de relevés, synchronisation Qonto optionnelle (comptes, transactions, justificatifs), règles d'affectation, rapprochement.
- Immobilisations et plan d'amortissement linéaire, tableau des amortissements.
- États : bilan, compte de résultat (avec configuration), balance, grand livre, journal, exports PDF et Excel.
- Tableau de bord : indicateurs, chiffre d'affaires et charges, trésorerie.
- Serveur MCP (`/api/mcp`) pour connecter Claude, ChatGPT ou Claude Code, avec OAuth 2.1 ou clés API.
- Auto-hébergement : déploiement en un clic sur Vercel avec Neon, page `/setup` pour le premier administrateur, emails via Resend.
- Calendrier des **échéances** fiscales et juridiques (`/<société>/echeances`, entrée Échéances des États) et widget **Échéances** du tableau de bord (dirigeant et comptable par défaut) : TVA (CA3 mensuelle ou trimestrielle, CA12 et acomptes du réel simplifié jusqu'à sa suppression au 1er janvier 2027), acomptes et solde de l'IS, déclaration de résultat et liasse, DAS2 et 1330-CVAE sur demande, CFE et son acompte, approbation et dépôt des comptes. Chaque date cite sa règle et ses sources (CGI, BOFiP, Code de commerce, impots.gouv.fr), suit les reports de week-end et de jour férié de l'administration et reste indicative : l'espace professionnel sur impots.gouv.fr fait foi. Une carte **Échéances** de la page Informations règle ce que Kledg ne peut pas deviner (jour de la CA3, fréquence, acomptes, dépôt en ligne). Dates seulement, aucun montant.
- Nouveaux hébergements, chacun avec son fichier de configuration et sa section dans [docs/self-hosting.md](docs/self-hosting.md) : Railway (`railway.json`), Render (`render.yaml`, bouton « Deploy to Render »), Fly.io (`fly.toml`), Clever Cloud (`deploy/clevercloud.env`), Coolify et Dokploy (`docker-compose.yml`, désormais l'instance complète avec sa base ; la base de développement passe dans `docker-compose.dev.yml`). La page **Mises à jour** reconnaît l'hébergeur et propose la mise à jour en deux clics partout où une fusion sur GitHub redéploie l'instance (`KLEDG_DEPLOYS_FROM_GITHUB`). L'URL publique se déduit des variables de l'hébergeur quand `BETTER_AUTH_URL` n'est pas défini, et `GET /api/health` résiste aux rafales (une requête à la base toutes les deux secondes au plus, 503 en quatre secondes si la base ne répond pas).
- Page **Mises à jour** pour les administrateurs : version installée, dernière version, notes de version et migrations de la base à venir ; indicateur « Mise à jour disponible ». Sur Vercel, connexion GitHub par jeton fine-grained (chiffré) pour préparer, vérifier et installer une mise à jour, et choisir le canal suivi. Hors Vercel, commandes de mise à jour.
- Page **Profil** (`/settings/profile`) : nom et avatar à initiales, changement de l'adresse email confirmé par un lien envoyé à la nouvelle adresse (avec un avis à l'ancienne), mot de passe (l'ancienne page Mot de passe y mène), sessions actives avec déconnexion d'une session ou des autres, suppression du compte (refusée au dernier administrateur de l'instance ou d'une société). Chaque action respecte la politique de l'instance.
- Page **Apparence** (`/settings/appearance`) : le thème (clair, sombre ou système, le même réglage que le bouton de l'en-tête) et les couleurs des graphiques, enregistrées dans le compte et donc identiques sur tous les appareils. Quatre palettes, chacune pour le thème clair et le thème sombre (Sobre, les couleurs actuelles et la palette par défaut ; Contrasté ; Daltonisme, sur la base de la palette Okabe-Ito ; Pastel), ou des couleurs personnalisées par série (produits, charges, trésorerie, répartition des charges, débit, crédit, solde cumulé) et par thème, avec un aperçu, un avertissement quand une couleur manque de contraste avec le fond des cartes (moins de 3:1) et le retour aux couleurs par défaut. Les graphiques prennent les nouvelles couleurs dès l'enregistrement, sans recharger la page. Une instance peut restreindre ce réglage (action `change-appearance`).
