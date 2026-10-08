# Mizu

Outil de gestion pour restaurants : **une seule application, une seule base de données**, trois espaces selon le rôle de la personne connectée.

| Espace | Pour qui | Contenu |
|---|---|---|
| **Restaurateur** (ordinateur + téléphone, installable) | Gérant d'un ou plusieurs établissements | Tableau de bord, Factures, Food cost, HACCP, Plannings et équipe, Commandes fournisseurs, Marketing, Contact |
| **Comptable** (ordinateur) | Expert-comptable | Clients restaurateurs (ajout / retrait), dépenses classées, TVA pré-calculée, heures par collaborateur, échéances, exports PDF et tableur — en lecture seule |
| **Collaborateur** (téléphone d'abord) | Employé | Bouton Pointer, Mon planning (temps réel), Mes heures et demandes de correction |

Un petit espace **Équipe Mizu** (rôle `support`) répond aux messages envoyés depuis « Contact ».

## Démarrage

Prérequis : Node.js ≥ 22.13 (SQLite intégré `node:sqlite`, aucune base externe).

```bash
npm run install:all   # dépendances serveur + client
npm run build         # construit l'interface (client/dist)
npm run seed          # (facultatif) base de démonstration — EFFACE la base existante
npm start             # http://localhost:3000
```

Développement : `npm run dev:server` (port 3000) et `npm run dev:client` (Vite sur 5173, proxy `/api`).

### Comptes de démonstration (mot de passe `Mizu-demo-2026`)

| Rôle | Email |
|---|---|
| Comptable | `comptable@mizu.demo` |
| Restaurateur (2 établissements) | `restaurateur@mizu.demo` |
| Collaborateur | `collaborateur@mizu.demo` |
| Équipe Mizu | `support@mizu.demo` |

## Configuration

| Variable | Rôle | Défaut |
|---|---|---|
| `PORT` | Port HTTP | `3000` |
| `ANTHROPIC_API_KEY` | Active la lecture des photos (factures, étiquettes) et les propositions marketing par IA (Claude) | non définie → saisie manuelle, photos conservées |
| `MIZU_AI_MODEL` | Modèle utilisé | `claude-opus-5-5` |
| `MIZU_TZ` | Fuseau horaire des restaurants | `Europe/Paris` |
| `MIZU_DATA_DIR` | Dossier de la base et des photos | `server/data` |
| `MIZU_PUSH_CONTACT` | Contact VAPID des notifications push | `mailto:contact@mizu.app` |
| `MIZU_ADMIN_EMAIL`, `MIZU_ADMIN_PASSWORD` | Base vide : crée le premier compte comptable au démarrage (qui crée ensuite ses restaurateurs) | — |
| `NODE_ENV=production` | Cookie de session `Secure` (HTTPS requis) | — |

Les notifications push et l'installation PWA nécessitent HTTPS en production (ou `localhost`).

## Règles métier

**Accès.** Chaque requête est contrôlée côté serveur : un restaurateur n'accède qu'à ses établissements, un collaborateur qu'à son planning et ses heures, un comptable qu'aux données de ses clients et uniquement en lecture. Le comptable crée et retire ses clients (le retrait désactive les comptes et conserve les données pour l'archivage légal) ; le restaurateur crée les comptes de ses collaborateurs.

**Factures.** Photo → lecture IA de chaque ligne (produit, quantité, unité kilo/litre/pièce/carton, prix d'achat HT, fournisseur, date de livraison) → correction possible → validation. La photo d'origine est conservée. Un produit vu pour la première fois doit être relié à un ingrédient (ou marqué « pas un ingrédient ») ; ensuite le lien est automatique, contenance des cartons comprise.

**Food cost** (`server/src/foodcost.js`), en précision complète, arrondi au centime uniquement à l'affichage :
- prix unitaire = prix d'achat HT ÷ quantité achetée (toujours le **dernier** prix connu)
- coût ingrédient = prix unitaire × quantité dans le plat
- food cost € = somme des coûts ; food cost % = food cost € ÷ prix de vente HT × 100
- prix de vente conseillé HT = food cost € ÷ food cost cible % × 100

Chaque facture validée recalcule les plats concernés et alerte si un plat devient moins rentable.

**Tableau de bord.** CA HT saisi chaque jour ; marge brute = CA HT − achats de marchandises HT (factures validées classées « Achats alimentaires » ou « Boissons », par date de livraison).

**HACCP.** Relevés de température avec seuils par équipement (action corrective obligatoire hors seuil + alerte), dates limites (photo d'étiquette lue par l'IA ou saisie manuelle, alertes J-2, J-1, jour J, dépassement), plan de nettoyage par zone et fréquence, allergènes par plat déduits des fiches techniques, archive PDF / tableur en un clic.

**Équipe.** Planning par glisser-déposer, diffusé en temps réel (SSE) avec notification au collaborateur ; vue « en direct » des pointages ; comparaison prévu / pointé et validation des heures. Le collaborateur ne peut jamais modifier un pointage : l'heure est fixée par le serveur et toute correction passe par une demande acceptée ou refusée par le restaurateur (l'heure d'origine est conservée).

**Commandes.** Stock minimum par ingrédient ; le stock augmente à chaque facture validée et s'ajuste à la main. Sous le minimum : alerte et commande proposée (objectif 2 × le minimum). Rien n'est transmis sans validation ; la validation ouvre un email pré-rempli au fournisseur et un bon de commande PDF.

**Marketing.** Tâches à faire / faites ; contenus proposés (IA ou modèles) à valider, jamais publiés automatiquement.

## Architecture

```
server/   Express 5 + node:sqlite — API REST, SSE temps réel, push web, exports PDF (pdfkit) et Excel (exceljs)
  src/db.js          schéma de la base unique
  src/routes/        common, r-* (restaurateur), collaborateur, comptable, support
client/   React 19 + Vite — PWA (manifest, service worker, icônes)
```
