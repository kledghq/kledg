# Contribuer à Kledg

Merci de votre intérêt ! Kledg est développé en public : corrections, nouvelles fonctionnalités, améliorations d'interface et retours d'experts-comptables sont les bienvenus.

## Avant de commencer

- Pour un bug, ouvrez une [issue](https://github.com/kledghq/kledg/issues) avec les étapes pour le reproduire.
- Pour une fonctionnalité ou un changement de règle comptable ou fiscale, ouvrez d'abord une issue pour en discuter : citez la source (article du PCG, BOFiP, notice du formulaire).
- Ne publiez jamais de données comptables réelles (FEC, relevés, factures) dans une issue : anonymisez-les.

## Mise en place

Suivez la section « Développement local » du [README](README.md).

## Proposer une modification

1. Créez une branche depuis `main`.
2. Écrivez des tests pour toute règle comptable ou fiscale (`lib/**/__tests__`).
3. Vérifiez avant d'ouvrir la pull request :

   ```bash
   pnpm typecheck
   pnpm lint
   pnpm test:run
   ```

4. Si vous modifiez `prisma/schema.prisma`, générez une migration avec `pnpm db:migrate:dev --name description-courte` et committez-la.
5. Ouvrez la pull request en décrivant le changement et la façon de le tester.

## Conventions

- Interface en français, code et commentaires en anglais.
- Messages de commit courts, à l'impératif, préfixés par le domaine : `Banking: match transfers by reference`.
- Pas de dépendance nouvelle sans raison claire.
- Montants : arrondis au centime, jamais de comparaison stricte entre flottants sans tolérance.

## Licence

En contribuant, vous acceptez que votre contribution soit publiée sous licence [AGPL-3.0](LICENSE).

## Publier une version

1. Déplacez les entrées de « Non publié » vers une nouvelle section `## [x.y.z] - AAAA-MM-JJ` dans [CHANGELOG.md](CHANGELOG.md) et mettez à jour `version` dans `package.json`.
2. Committez, puis créez et poussez le tag : `git tag vx.y.z && git push origin vx.y.z`.
3. Le workflow *Release* publie la release GitHub avec les notes du changelog. Les instances se mettent à jour en récupérant `main`.
