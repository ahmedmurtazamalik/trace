import { expect, test } from '@playwright/test';
import { PrismaClient } from '../../../packages/database/src';

const prisma = new PrismaClient();
const password = 'correct-horse-battery-staple';
const managerUsername = 'e2e.inv.manager';
const developerUsername = 'e2e.inv.developer';
const workspaceName = 'E2E Invitation Workspace';

async function clean(): Promise<void> {
  await prisma.workspace.deleteMany({ where: { name: workspaceName } });
  await prisma.user.deleteMany({ where: { username: { in: [managerUsername, developerUsername] } } });
}

test.beforeAll(clean);
test.afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

test('Manager invitation requires recipient acceptance before real database membership', async ({ page, request, browser }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:3100' });
  for (const username of [managerUsername, developerUsername]) {
    const response = await request.post('http://127.0.0.1:3201/api/v1/auth/register', { data: { username, password } });
    expect(response.status()).toBe(201);
  }

  await page.goto('/login');
  await page.getByLabel('Username').fill(managerUsername);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/workspaces');
  await page.getByLabel('Workspace name').fill(workspaceName);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.getByRole('button', { name: new RegExp(`Open ${workspaceName}`) }).click();
  await page.getByLabel('Trace username').fill(developerUsername);
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText(`@${developerUsername}`, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Copy invitation link for @${developerUsername}` }).click();
  const invitationUrl = await page.evaluate(() => navigator.clipboard.readText());
  expect(invitationUrl).toMatch(/^http:\/\/127\.0\.0\.1:3100\/invitations\/[A-Za-z0-9_-]+#token=[A-Za-z0-9_-]{43}$/);
  const copiedUrl = new URL(invitationUrl);
  const invitationPath = `${copiedUrl.pathname}${copiedUrl.hash}`;

  const invitedUser = await prisma.user.findUniqueOrThrow({ where: { username: developerUsername } });
  const workspace = await prisma.workspace.findFirstOrThrow({ where: { name: workspaceName } });
  expect(await prisma.workspaceMembership.count({ where: { workspaceId: workspace.id, userId: invitedUser.id } })).toBe(0);
  expect(await prisma.workspaceInvitation.count({ where: { workspaceId: workspace.id, invitedUserId: invitedUser.id, status: 'PENDING' } })).toBe(1);

  await page.goto(invitationPath!);
  await expect(page.getByText('This invitation is unavailable. It may be expired, revoked, already used, or intended for another Trace account.')).toBeVisible();
  expect(await prisma.workspaceMembership.count({ where: { workspaceId: workspace.id, userId: invitedUser.id } })).toBe(0);

  const recipientContext = await browser.newContext({
    baseURL: 'http://127.0.0.1:3100',
    storageState: { cookies: [], origins: [] },
  });
  expect(await recipientContext.cookies()).toEqual([]);
  const recipientPage = await recipientContext.newPage();
  const serverVisibleRequestUrls: string[] = [];
  recipientPage.on('request', (browserRequest) => serverVisibleRequestUrls.push(browserRequest.url()));
  await recipientPage.goto(invitationPath);
  await expect(recipientPage).toHaveURL(/\/login\?returnTo=%2Finvitations%2F[A-Za-z0-9_-]+#token=[A-Za-z0-9_-]{43}$/);
  const loginUrl = new URL(recipientPage.url());
  expect(loginUrl.search).not.toContain('token');
  expect(loginUrl.hash).toBe(copiedUrl.hash);
  await recipientPage.getByLabel('Username').fill(developerUsername);
  await recipientPage.getByLabel('Password').fill(password);
  await recipientPage.getByRole('button', { name: 'Sign in' }).click();
  await expect(recipientPage).toHaveURL(new RegExp(`${copiedUrl.pathname}#token=[A-Za-z0-9_-]{43}$`));
  expect(serverVisibleRequestUrls.every((url) => !new URL(url).search.includes('token') && !url.includes('%23token'))).toBe(true);
  const recipientSession = await recipientContext.request.get('http://127.0.0.1:3201/api/v1/auth/me');
  expect(recipientSession.status()).toBe(200);
  expect(((await recipientSession.json()) as { user: { username: string } }).user.username).toBe(developerUsername);
  await expect(recipientPage.getByRole('heading', { name: workspaceName, exact: true })).toBeVisible();
  await recipientPage.getByRole('button', { name: `Accept ${workspaceName} invitation` }).click();
  await expect(recipientPage.getByText(`You joined ${workspaceName}.`, { exact: false })).toBeVisible();

  expect(await prisma.workspaceMembership.count({ where: { workspaceId: workspace.id, userId: invitedUser.id } })).toBe(1);
  expect(await prisma.workspaceInvitation.findFirstOrThrow({ where: { workspaceId: workspace.id, invitedUserId: invitedUser.id } })).toMatchObject({ status: 'ACCEPTED' });
  await recipientPage.reload();
  await expect(recipientPage.getByRole('button', { name: `Accept ${workspaceName} invitation` })).toHaveCount(0);
  expect(await prisma.workspaceMembership.count({ where: { workspaceId: workspace.id, userId: invitedUser.id } })).toBe(1);
  await recipientContext.close();
});
