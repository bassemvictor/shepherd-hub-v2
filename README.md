# Project Starter Template

This repo is a lightweight starter built from the original Tender App foundations. It keeps the same core stack and UX patterns, but trims the product down to two sample pages so future apps can be built on top of it without carrying tender-specific business logic.

## What stays in the template

- AWS Amplify Gen 2
- Cognito authentication with email/password sign-in
- API Gateway HTTP API with Cognito authorizer
- Lambda backend
- DynamoDB single-table storage
- React + TypeScript frontend
- Protected routes and authenticated API calls
- Side menu app shell
- Existing styling approach and UI component set
- Responsive card, table, and right-side drawer patterns

## Included sample pages

### 1. Dashboard

- Confirms protected routing works
- Shows the authenticated user from Amplify session state
- Displays Cognito groups from token claims when available
- Loads a simple backend summary from `/dashboard/summary`

### 2. Sample Records

- Demonstrates a reusable grid/table pattern
- Loads records from DynamoDB through API Gateway + Lambda
- Supports list, get, create, update, and delete
- Uses the right-side drawer pattern for create/edit/view flows

## Authentication flow

Frontend auth lives in [src/lib/auth.tsx](/Users/sallysamuel/workspace/amplify-react-template/src/lib/auth.tsx:1).

- Amplify is configured from `amplify_outputs.json` in [src/lib/amplify.ts](/Users/sallysamuel/workspace/amplify-react-template/src/lib/amplify.ts:1).
- `AuthProvider` reads the signed-in user and token claims once from Amplify session APIs.
- `ProtectedRoute` in [src/components/auth/protected-route.tsx](/Users/sallysamuel/workspace/amplify-react-template/src/components/auth/protected-route.tsx:1) blocks unauthenticated access.
- The frontend API client adds the bearer token automatically in [src/lib/api.ts](/Users/sallysamuel/workspace/amplify-react-template/src/lib/api.ts:1).
- The Lambda uses JWT claims from API Gateway authorizer context instead of calling Cognito repeatedly.

## Frontend to backend flow

1. User signs in through Cognito.
2. Amplify stores the session.
3. The frontend calls `api.get/post/put/delete(...)`.
4. `src/lib/api.ts` attaches the bearer token to the request.
5. API Gateway validates the token with the Cognito authorizer.
6. Lambda reads tenant/user/group information from JWT claims.
7. Lambda reads or writes DynamoDB and returns JSON back to the React page.

## Backend structure

Backend infrastructure is defined in [amplify/backend.ts](/Users/sallysamuel/workspace/amplify-react-template/amplify/backend.ts:1).

- Auth: [amplify/auth/resource.ts](/Users/sallysamuel/workspace/amplify-react-template/amplify/auth/resource.ts:1)
- Lambda: [amplify/functions/project-template-api/resource.ts](/Users/sallysamuel/workspace/amplify-react-template/amplify/functions/project-template-api/resource.ts:1)
- Lambda handler: [amplify/functions/project-template-api/handler.ts](/Users/sallysamuel/workspace/amplify-react-template/amplify/functions/project-template-api/handler.ts:1)
- Table: DynamoDB single table with `PK` and `SK`

### API routes

- `GET /dashboard/summary`
- `GET /records`
- `GET /records/{recordId}`
- `POST /records`
- `PUT /records/{recordId}`
- `DELETE /records/{recordId}`

### DynamoDB shape

The sample entity uses tenant-aware keys:

- `PK = TENANT#{tenantId}`
- `SK = RECORD#{recordId}`

Each record stores:

- `recordId`
- `name`
- `status`
- `owner`
- `tenantId`
- `createdAt`
- `updatedAt`
- `entityType`

Tenant resolution is claim-based in the Lambda:

- Preferred: `custom:tenantId`
- Fallback: `custom:tenant_id`
- Final fallback: Cognito `sub`

## Reusable frontend pieces

These are the main template building blocks:

- `AppShell`: [src/components/layout/app-shell.tsx](/Users/sallysamuel/workspace/amplify-react-template/src/components/layout/app-shell.tsx:1)
- `SideMenu`: [src/components/layout/side-menu.tsx](/Users/sallysamuel/workspace/amplify-react-template/src/components/layout/side-menu.tsx:1)
- `ProtectedRoute`: [src/components/auth/protected-route.tsx](/Users/sallysamuel/workspace/amplify-react-template/src/components/auth/protected-route.tsx:1)
- `PageHeader`: [src/components/common/page-header.tsx](/Users/sallysamuel/workspace/amplify-react-template/src/components/common/page-header.tsx:1)
- `DataGrid`: [src/components/common/data-grid.tsx](/Users/sallysamuel/workspace/amplify-react-template/src/components/common/data-grid.tsx:1)
- `RightSideDrawer`: [src/components/common/right-side-drawer.tsx](/Users/sallysamuel/workspace/amplify-react-template/src/components/common/right-side-drawer.tsx:1)
- `FormDrawer`: [src/components/common/form-drawer.tsx](/Users/sallysamuel/workspace/amplify-react-template/src/components/common/form-drawer.tsx:1)
- `StatusBadge`: [src/components/common/status-badge.tsx](/Users/sallysamuel/workspace/amplify-react-template/src/components/common/status-badge.tsx:1)
- `ConfirmDialog`: [src/components/common/confirm-dialog.tsx](/Users/sallysamuel/workspace/amplify-react-template/src/components/common/confirm-dialog.tsx:1)
- `EmptyState`: [src/components/states/empty-state.tsx](/Users/sallysamuel/workspace/amplify-react-template/src/components/states/empty-state.tsx:1)
- `LoadingState`: [src/components/states/loading-state.tsx](/Users/sallysamuel/workspace/amplify-react-template/src/components/states/loading-state.tsx:1)
- `ErrorState`: [src/components/states/error-state.tsx](/Users/sallysamuel/workspace/amplify-react-template/src/components/states/error-state.tsx:1)

## How to add a new page

1. Create a page component under `src/pages/`.
2. Add a route in [src/routes/router.tsx](/Users/sallysamuel/workspace/amplify-react-template/src/routes/router.tsx:1).
3. If needed, add a page title/breadcrumb mapping in [src/lib/route-metadata.ts](/Users/sallysamuel/workspace/amplify-react-template/src/lib/route-metadata.ts:1).
4. Add a menu item in `SideMenu`.

## How to add a new side menu item

Edit the `baseNavigation` array in [src/components/layout/side-menu.tsx](/Users/sallysamuel/workspace/amplify-react-template/src/components/layout/side-menu.tsx:1).

Each item needs:

- `label`
- `href`
- optional `icon`

## How to add a new grid

1. Build your page data loader.
2. Define columns with `DataGridColumn<T>`.
3. Render `DataGrid` with:
   - `columns`
   - `rows`
   - `getRowKey`
   - empty-state text

See [src/pages/sample-records-page.tsx](/Users/sallysamuel/workspace/amplify-react-template/src/pages/sample-records-page.tsx:1) for the reference pattern.

## How to add a new right-side drawer form

1. Keep open/close state in the page.
2. Use `FormDrawer` for editable flows.
3. Use `RightSideDrawer` for view-only details.
4. Keep the form state local to the page unless multiple pages need the same form.

The sample records page demonstrates:

- create drawer
- edit drawer
- read-only details drawer
- delete confirmation dialog

## How to add a new Lambda CRUD route

1. Add the route in [amplify/backend.ts](/Users/sallysamuel/workspace/amplify-react-template/amplify/backend.ts:1).
2. Add the handler branch in [amplify/functions/project-template-api/handler.ts](/Users/sallysamuel/workspace/amplify-react-template/amplify/functions/project-template-api/handler.ts:1).
3. Add shared request/response types in [shared/types.ts](/Users/sallysamuel/workspace/amplify-react-template/shared/types.ts:1).
4. Call the route from the frontend through `src/lib/api.ts`.
5. Add or update Lambda tests in `tests/`.

## Environment variables

### Frontend

- `VITE_API_BASE_URL`
  - Optional when `amplify_outputs.json` already contains the generated API endpoint
  - Useful for local overrides

### Backend

- `PROJECT_TEMPLATE_TABLE`
  - Set automatically by Amplify for the Lambda

Optional JWT claims for tenanting:

- `custom:tenantId`
- `custom:tenant_id`

## Local development

Install dependencies:

```bash
npm install
```

Start Amplify sandbox:

```bash
npx ampx sandbox
```

Regenerate outputs after sandbox or deploy:

```bash
npx ampx generate outputs
```

Start the React app:

```bash
npm run dev
```

Run verification:

```bash
npm run build
npm run test:lambda
```

## Notes

- `amplify_outputs.json` must be regenerated after creating a fresh sandbox or deploy.
- The template intentionally removed tender-specific workflows, forms, calculations, and entities.
- The current sample uses a single generic `record` entity so new teams can copy the structure without carrying old domain logic forward.
