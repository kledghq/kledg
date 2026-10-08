<p align="center">
  <a href="https://www.kledg.com"><img src="public/logo.svg" width="56" height="56" alt="Kledg" /></a>
</p>

<h1 align="center">Kledg</h1>

<p align="center">
  Le logiciel comptable gratuit pour produire votre bilan et votre compte de résultat chaque année.<br />
  <sub>Open-source accounting for French companies (PCG 2026), self-hosted on Vercel and Neon.</sub>
</p>

<p align="center">
  <a href="https://www.kledg.com">Site</a> ·
  <a href="https://demo.kledg.com">Démo</a> ·
  <a href="https://www.kledg.com/fr/deploy">Déployer</a> ·
  <a href="docs/README.md">Documentation</a> ·
  <a href="CONTRIBUTING.md">Contribuer</a>
</p>

---

Kledg tient la comptabilité générale des petites sociétés françaises (SASU, EURL, SARL, SAS, SCI à l'IS, holdings) : plan comptable PCG 2026, saisie et import d'écritures, banque et rapprochement, immobilisations, clôture, bilan, compte de résultat et export FEC. Il est gratuit et open source : vous le déployez vous-même, vos données restent dans votre base PostgreSQL.

Et votre assistant IA peut y travailler : chaque instance expose un **serveur MCP** pour connecter Claude ou ChatGPT à votre comptabilité ([docs/mcp.md](docs/mcp.md)).

## Déployer en un clic

Le plus simple : [le déploiement guidé de kledg.com](https://www.kledg.com/fr/deploy). Il prépare le compte Vercel, génère le secret dans votre navigateur, vous accompagne écran par écran et donne à la fin le lien qui crée le compte administrateur. Le bouton ci-dessous fait la même chose, sans guide :

[![Déployer sur Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fkledghq%2Fkledg&project-name=kledg&repository-name=kledg&env=BETTER_AUTH_SECRET%2CADMIN_EMAIL&envDescription=BETTER_AUTH_SECRET%20%3A%20un%20secret%20al%C3%A9atoire%20%28bouton%20G%C3%A9n%C3%A9rer%20sur%20la%20page%20li%C3%A9e%29.%20ADMIN_EMAIL%20%3A%20votre%20email%2C%20qui%20recevra%20le%20lien%20de%20cr%C3%A9ation%20du%20compte%20administrateur.&envLink=https%3A%2F%2Fwww.kledg.com%2Ffr%2Fdocs%2Finstaller-kledg%23d%C3%A9ployer-sur-vercel&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22neon%22%2C%22productSlug%22%3A%22neon%22%2C%22protocol%22%3A%22storage%22%7D%2C%7B%22type%22%3A%22blob%22%2C%22access%22%3A%22private%22%7D%5D&demo-title=Kledg&demo-description=La%20comptabilit%C3%A9%20fran%C3%A7aise%20open%20source%20de%20votre%20soci%C3%A9t%C3%A9%2C%20avec%20un%20serveur%20MCP%20pour%20Claude%20et%20ChatGPT.&demo-url=https%3A%2F%2Fdemo.kledg.com&demo-image=https%3A%2F%2Fwww.kledg.com%2Ffr%2Fopengraph-image&redirect-url=https%3A%2F%2Fwww.kledg.com%2Ffr%2Fwelcome)

Le bouton crée le projet Vercel, provisionne une base **Neon** et un magasin **Vercel Blob** privé pour les fichiers des justificatifs, et ne demande que `BETTER_AUTH_SECRET` et `ADMIN_EMAIL`. Au premier déploiement, les migrations s'appliquent automatiquement ; ouvrez ensuite le lien d'installation `/setup?token=…` que donne le guide de déploiement de kledg.com : il crée le compte administrateur.

### Autres hébergeurs

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/kledghq/kledg)

| Hébergeur | Fichier | Guide |
| --- | --- | --- |
| Render | `render.yaml` (bouton ci-dessus) | [Render](docs/self-hosting.md#render) |
| Railway | `railway.json` | [Railway](docs/self-hosting.md#railway) |
| Fly.io | `fly.toml` | [Fly.io](docs/self-hosting.md#flyio) |
| Clever Cloud (hébergeur français) | `deploy/clevercloud.env` | [Clever Cloud](docs/self-hosting.md#clever-cloud) |
| Coolify, Dokploy, Docker | `docker-compose.yml` | [Coolify et Dokploy](docs/self-hosting.md#coolify-et-dokploy), [Docker](docs/self-hosting.md#docker) |

Le guide complet est dans [docs/self-hosting.md](docs/self-hosting.md).

## Fonctionnalités

| Domaine | Ce que fait Kledg |
| --- | --- |
| Sociétés | Multi-sociétés, informations et établissements, membres et rôles (administrateur, comptable, lecture seule), modes d'affichage Simple, Standard et Expert, menu personnalisable |
| Comptabilité | Plan comptable PCG 2026, journaux, exercices (ouverture, clôture des périodes et de l'exercice, à-nouveaux), écritures avec contrôles PCG, lettrage |
| Banque | Import de relevés, synchronisation Qonto et Revolut Business en direct, autres banques via Ponto, règles d'affectation et leur bibliothèque, rapprochement, justificatifs (fournisseur reconnu, lien vers ses factures), prévision de trésorerie avec seuil d'alerte |
| Factures et tiers | Clients et fournisseurs, factures d'achat et de vente, numérotation continue, création dans Qonto, import des factures Qonto, notes de frais, frais de gestion d'une holding |
| Déclarations | TVA (CA3 et CA12), impôt sur les sociétés, CFE et CVAE, coefficient de déduction de TVA, taxe sur les salaires, bilan pédagogique et financier, calendrier des échéances ; Kledg prépare, vous déposez |
| Clôture | Immobilisations et amortissements, provisions, dépréciations, subventions, annexe et tableaux 2054, 2055 et 2033-C, approbation des comptes |
| États | Bilan, compte de résultat, SIG et ratios, balances, grand livre, journal, budget, exports PDF et Excel, espace groupe pour les holdings |
| Données | Export FEC au format de l'article A47 A-1 du LPF, contrôlé à l'export, import FEC, CSV et Excel |
| Assistants IA | Serveur MCP pour Claude, ChatGPT et Claude Code (OAuth ou clé API), vues interactives dans l'assistant, « Proposer avec l'IA » depuis les pages |

**Pas encore dans Kledg** : liasse fiscale complète et télétransmission, émission du document de facture hors Qonto, paie, import Factur-X. La feuille de route est dans les [issues](https://github.com/kledghq/kledg/issues?q=is%3Aissue+is%3Aopen+label%3Aroadmap).

## Stack

- **Next.js 16** (App Router) et **React 19**, interface **shadcn/ui** et Tailwind CSS 4
- **PostgreSQL** via **Prisma 7** (adaptateur `pg`) : Neon par défaut, toute base PostgreSQL convient
- **Better Auth** pour l'authentification, **Resend** pour les emails
- **Model Context Protocol** : serveur MCP intégré, sans clé de modèle à configurer

## Développement local

Prérequis : Node.js 20.9+, pnpm, Docker (ou un PostgreSQL existant).

```bash
git clone https://github.com/kledghq/kledg.git && cd kledg
pnpm install
docker compose -f docker-compose.dev.yml up -d   # PostgreSQL local
cp .env.example .env    # puis renseignez BETTER_AUTH_SECRET et ADMIN_EMAIL
pnpm db:migrate
pnpm dev
```

Ouvrez http://localhost:3000 : vous arrivez sur `/setup`. Sans `RESEND_API_KEY`, les emails (réinitialisation de mot de passe, invitations) s'affichent dans la console du serveur.

| Commande | Rôle |
| --- | --- |
| `pnpm dev` | Serveur de développement |
| `pnpm test:run` | Tests (Vitest) |
| `pnpm typecheck` | Vérification TypeScript |
| `pnpm lint` | ESLint |
| `pnpm db:migrate:dev` | Créer une migration après modification de `prisma/schema.prisma` |
| `pnpm db:studio` | Explorer la base |

## Documentation

- **Guides d'utilisation** : sur le site, [www.kledg.com/fr/docs](https://www.kledg.com/fr/docs). Installer, créer sa société, connecter sa banque, rapprocher, déclarer la TVA et l'IS, clôturer : chaque fonctionnalité expliquée au dirigeant et à l'expert-comptable, avec les règles de droit qui s'appliquent.
- **Documentation technique** : dans ce dépôt, [docs/](docs/README.md). Architecture, conventions, sécurité (RLS), configuration, auto-hébergement, serveur MCP, points d'extension, et le fonctionnement technique de chaque fonctionnalité (code, API, règles de calcul, droits).

Une modification qui change ce que voit l'utilisateur met à jour le guide du site ; une modification du code met à jour la page technique de `docs/`.

## Avertissement

Kledg est un outil d'aide à la tenue de comptabilité. Il ne remplace pas un expert-comptable : vérifiez vos états avant de les utiliser. Le logiciel est fourni sans garantie (voir la licence).

## Licence

[AGPL-3.0](LICENSE). Vous pouvez utiliser, modifier et héberger Kledg librement ; si vous proposez une version modifiée à des tiers via un réseau, vous devez publier vos modifications sous la même licence.
