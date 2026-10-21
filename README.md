# LCA-MES

### A manufacturing management application built from laboratory needs

LCA-MES is a web application for managing product catalogues, recipes, inventory, batch preparation, production, and lot traceability.

Its purpose is to progressively replace spreadsheet-based preparation with a structured workflow that connects production decisions to available stock.

## About the project

Created by **Alexandre Bouillault**, an Assistant Laboratory Manager transitioning into Product Building.

The project brings together operational knowledge, requirements definition, business-rule clarification, prioritisation, and iteration based on user feedback.

Development is AI-assisted, with **Claude Code as the primary implementation assistant**. This repository documents both the application and the product decisions behind it.

## Capabilities

| Area | Overview |
| --- | --- |
| Catalogue | Products, materials, packaging, suppliers, and versioned recipes |
| Preparation | Calculation of ingredient and packaging requirements |
| Inventory | Stock receipts, movements, adjustments, and consumption tracking |
| Production | Batch preparation, progress tracking, stoppages, and closure |
| Feasibility | Inventory checks before starting production |
| Traceability | Finished-lot genealogy and supplier-lot lookup |
| Imports | Spreadsheet imports with preview and confirmation |
| Administration | User accounts and role-based access |
| Feedback | In-app collection of user feedback |
| AI assistant | Optional conversational access to read-only business tools |

Quality, costing, and an R&D sample library also have backend implementations documented in the repository. Delivery maturity differs by module; this overview does not imply that every feature is production-ready.

## Product approach

The project focuses on three practical concerns:

- **Make problems visible before work starts.** Batch feasibility checks help operators identify material shortages before starting production.
- **Preserve traceability.** Production records connect finished lots to the materials consumed.
- **Keep decisions explicit.** Imports require preview and confirmation, and the AI assistant is limited to read-only business tools.

These are product behaviours, not claims of measured productivity gains.

## Technology

- **Backend:** NestJS and TypeScript
- **Frontend:** React, Vite, TypeScript, and Tailwind CSS
- **Database:** PostgreSQL and Prisma
- **Organisation:** npm workspaces with shared TypeScript contracts
- **Architecture:** modular monolith
- **Testing:** Jest/Supertest for the API; Vitest/Testing Library for the frontend
- **Deployment:** optional Docker Compose configuration

## Repository structure

```text
apps/
  api/          Backend and database integration
  web/          React frontend
packages/
  shared/       Shared TypeScript contracts
docs/           Product and technical documentation
scripts/        Operational tooling
```

## Getting started

Local development uses Node.js, npm, and PostgreSQL. Docker is optional.

1. Clone this repository and run `npm install`.
2. Create a dedicated local PostgreSQL database.
3. Copy `apps/api/.env.example` to `apps/api/.env` and configure your own local settings.
4. Run `npm run prisma:generate` and `npm run prisma:migrate`.
5. Review the development seed before running `npm run prisma:seed`.
6. Start the API and frontend in separate terminals:

```bash
npm run dev:api
npm run dev:web
```

The frontend is available at http://localhost:5173 and the API at http://localhost:3000.

Use a Node.js version compatible with the current workspace dependencies. Keep actual credentials outside version control and use separate databases for development and tests.

## Development commands

```bash
# Backend unit tests
npm run test:api

# Backend end-to-end tests — requires a dedicated test database
npm run test:api:e2e

# Frontend tests
npm run test --workspace apps/web

# Build applications
npm run build:api
npm run build:web
```

These commands are provided for verification; they were not executed as part of this README update.

## Project status

LCA-MES is an evolving product. The repository distinguishes implemented functionality from planned work.

- Quality and costing are documented as backend-only.
- Automated scheduling, machine connectivity, mobile applications, and full multi-site management are outside the delivered V0.9 scope.
- The AI assistant does not perform business writes.
- Deployment and operational readiness require independent validation. Existing documentation records that the Docker configuration had not yet been validated with a real Docker runtime.
- No quantified business impact is claimed without supporting measurements.

See [PROJECT_STATE.md](./PROJECT_STATE.md) for dated implementation and verification records. Detailed documentation is primarily in French.

## Documentation

| Resource | Purpose |
| --- | --- |
| [Project state](./PROJECT_STATE.md) | Delivery status and known limitations |
| [Master specification](./MASTER_SPECIFICATION.md) | Functional and technical requirements |
| [Backlog](./MASTER_BACKLOG.md) | Priorities and technical debt |
| [Architecture](./docs/architecture.md) | Technical organisation |
| [Roadmap](./docs/roadmap.md) | Delivery milestones |
| [Architecture decisions](./docs/adr/) | Decisions and trade-offs |
