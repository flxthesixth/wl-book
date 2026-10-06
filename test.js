import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWallet, csv, register, changeRole, adminLogChannel, parseDeadline, formatDeadline, mention, memberHelp, adminHelp, client, prisma } from './src.js';
import { commands } from './register.js';
test('member commands use private wallet modal and admin command stays restricted', () => {
  const specs = commands.map(c => c.toJSON());
  assert.deepEqual(specs.map(c => c.name).sort(), ['check', 'helpadmin', 'helpmember', 'submit', 'update', 'whitelist']);
  for (const name of ['submit', 'update', 'check']) {
    const command = specs.find(c => c.name === name);
    assert.equal(command.options?.length ?? 0, 0, 'wallet must not appear in slash command options');
    assert.equal(command.default_member_permissions, undefined);
  }
  assert.equal(specs.find(c => c.name === 'whitelist').default_member_permissions, '8');
  assert.doesNotMatch(memberHelp, /panel/i);
  assert.doesNotMatch(adminHelp, /panel/i);
});
const guildId = '123456789012345678', discordId = '223456789012345678', role = '323456789012345678', silver = '523456789012345678';
const wallet = `0x${'AB'.repeat(20)}`;
function mock() {
  let config = { id: guildId, eligibleRoleIds: [role, silver], locked: false, deadline: null, logChannelId: guildId };
  const records = new Map();
  const tx = {
    guild: { upsert: async () => config, findUniqueOrThrow: async () => config, update: async ({ data }) => (config = { ...config, ...data }) },
    $queryRaw: async () => [{ id: guildId }],
    registration: {
      findUnique: async ({ where }) => records.get(where.guildId_discordId.discordId) ?? null,
      create: async ({ data }) => { if ([...records.values()].some(x => x.wallet === data.wallet)) throw Object.assign(new Error('unique'), { code: 'P2002' }); records.set(data.discordId, data); return data; },
      update: async ({ where, data }) => { const id = where.guildId_discordId.discordId; if ([...records.values()].some(x => x.wallet === data.wallet && x.discordId !== id)) throw Object.assign(new Error('unique'), { code: 'P2002' }); const result = { ...records.get(id), ...data }; records.set(id, result); return result; }
    }
  };
  return { $transaction: fn => fn(tx), set: change => { config = { ...config, ...change }; }, records, config: () => config };
}
test('Discord IDs render as readable mentions without enabling pings', () => {
  assert.equal(mention('role', '123456789012345678'), '<@&123456789012345678>');
  assert.equal(mention('channel', '223456789012345678'), '<#223456789012345678>');
  assert.equal(mention('user', '323456789012345678'), '<@323456789012345678>');
  assert.equal(mention('role', 'bad'), 'bad');
});
test('deadline displays local time in Discord without milliseconds', () => {
  assert.equal(formatDeadline(new Date('2026-12-01T12:00:00Z')), '<t:1796126400:F> (<t:1796126400:R>)');
  assert.equal(formatDeadline(null), 'none');
});
test('deadline accepts valid UTC seconds and rejects invalid or past dates', () => {
  const now = new Date('2026-10-06T00:00:00Z');
  assert.equal(parseDeadline('2026-12-01 12:00', now).toISOString(), '2026-12-01T12:00:00.000Z');
  assert.equal(parseDeadline('2026-12-01T12:00:00Z', now).toISOString(), '2026-12-01T12:00:00.000Z');
  assert.equal(parseDeadline('clear', now), null);
  for (const input of ['2026-02-30 12:00', '2026-10-05 12:00', '2026-12-01 24:00', '2026-12-01 12:60', '2026-12-01 12:00+07:00', '2026-12-01T12:00:00+07:00']) assert.throws(() => parseDeadline(input, now));
});
test('help covers member actions and admin setup without exposing wallets', () => {
  for (const text of [memberHelp, adminHelp]) assert.ok(text.length <= 2000);
  for (const action of ['/submit', '/check', '/update']) assert.ok(memberHelp.includes(action));
  for (const action of ['log', 'role-add', 'stats', 'lock', 'deadline', 'lookup', 'export', 'snapshot']) assert.ok(adminHelp.includes(action));
  assert.match(memberHelp, /ownership is not verified/);
});
test('canonical EVM address and CSV spreadsheet injection safety', () => {
  assert.equal(normalizeWallet(` ${wallet} `), wallet.toLowerCase());
  for (const invalid of ['0X' + 'a'.repeat(40), '0x' + 'z'.repeat(40), '0x123', 123]) assert.throws(() => normalizeWallet(invalid));
  assert.match(csv([{ discordId, username: '=evil,"quoted"', wallet, eligibleRoleId: role, createdAt: new Date('2026-01-01Z'), updatedAt: new Date('2026-01-01Z') }]), /"'=evil,""quoted"""/);
});
test('CSV exports role names and readable UTC timestamps', () => {
  const rows = [{ discordId, username: 'tester', wallet, eligibleRoleId: role, createdAt: new Date('2026-12-01T12:05:09.123Z'), updatedAt: new Date('2026-12-02T00:01:02.000Z') }];
  const output = csv(rows, new Map([[role, { name: 'Gold, WL' }]]));
  assert.equal(output, `discordId,username,wallet,eligibleRole,createdAt,updatedAt\r\n"${discordId}","tester","${wallet}","Gold, WL","2026-12-01 12:05:09 UTC","2026-12-02 00:01:02 UTC"\r\n`);
  assert.doesNotMatch(output, new RegExp(role));
});
test('CSV handles deleted roles and escapes hostile role names', () => {
  const row = { discordId, username: 'tester', wallet, eligibleRoleId: role, createdAt: new Date('2026-12-01T12:00:00Z'), updatedAt: new Date('2026-12-01T12:00:00Z') };
  assert.match(csv([row], new Map()), /"Deleted role"/);
  assert.match(csv([row], new Map([[role, { name: '=evil,"quoted"' }]])), /"'=evil,""quoted"""/);
});
test('submit, update, role, lock and deadline enforce policy', async () => {
  const db = mock();
  const input = { guildId, discordId, username: 'tester', wallet, roles: [role] };
  await assert.rejects(register(db, { ...input, roles: [], mode: 'submit' }), /Eligible role/);
  await assert.rejects(register(db, { ...input, mode: 'update' }), /No registration/);
  await register(db, { ...input, mode: 'submit' });
  assert.equal(db.records.get(discordId).wallet, wallet.toLowerCase());
  await assert.rejects(register(db, { ...input, mode: 'submit' }), /Already registered/);
  db.set({ locked: true });
  await assert.rejects(register(db, { ...input, mode: 'update' }), /closed/);
  db.set({ locked: false, deadline: new Date('2020-01-01') });
  await assert.rejects(register(db, { ...input, mode: 'update' }), /closed/);
  db.set({ deadline: null });
  await register(db, { ...input, mode: 'update', wallet: `0x${'cd'.repeat(20)}` });
  assert.equal(db.records.get(discordId).wallet, `0x${'cd'.repeat(20)}`);
});
test('eligible roles preserve order, role changes and registration match', async () => {
  const db = mock();
  const input = { guildId, discordId, username: 'tester', wallet, roles: [silver, role] };
  const first = await register(db, { ...input, mode: 'submit' });
  assert.equal(first.result.eligibleRoleId, role);
  assert.equal(first.logChannelId, guildId);
  await changeRole(db, guildId, role, 'remove');
  const next = await register(db, { ...input, mode: 'update' });
  assert.equal(next.result.eligibleRoleId, silver);
  await changeRole(db, guildId, role, 'add');
  await changeRole(db, guildId, role, 'add');
  assert.deepEqual(db.config().eligibleRoleIds, [silver, role]);
  await changeRole(db, guildId, silver, 'remove');
  await changeRole(db, guildId, role, 'remove');
  await assert.rejects(register(db, { ...input, mode: 'update' }), /Registration requires/);
  db.set({ eligibleRoleIds: [role], logChannelId: null });
  await assert.rejects(register(db, { ...input, mode: 'update' }), /Registration requires/);
});
test('admin log rejects public role, member override, wrong guild and non-text channel', async () => {
  const { PermissionFlagsBits, OverwriteType } = await import('discord.js');
  const make = (publicRole = false, overrides = [], id = guildId) => ({
    guildId: id, guild: { roles: { fetch: async () => new Map([
      ['everyone', { permissions: { has: () => false }, id: 'everyone' }],
      ['staff', { permissions: { has: bit => bit === PermissionFlagsBits.Administrator }, id: 'staff' }]
    ]) } },
    isTextBased: () => true, send: async () => {},
    permissionsFor: role => ({ has: () => role.id === 'staff' || publicRole }),
    permissionOverwrites: { cache: overrides }
  });
  await adminLogChannel(make(), guildId);
  await assert.rejects(adminLogChannel(make(true), guildId), /non-admin roles/);
  await assert.rejects(adminLogChannel(make(false, [{ type: OverwriteType.Member, allow: { has: () => true } }]), guildId), /member-specific/);
  await assert.rejects(adminLogChannel(make(false, [], '999999999999999999'), guildId), /Admin-only/);
  await assert.rejects(adminLogChannel({ ...make(), isTextBased: () => false }, guildId), /Admin-only/);
});
test('PostgreSQL constraints, concurrent writes, and closed-window update', { skip: !process.env.DATABASE_URL }, async () => {
  const suffix = String(Date.now()).slice(-12);
  const testGuild = `12345${suffix}`;
  const base = { guildId: testGuild, username: 'db-user', roles: [role], wallet, mode: 'submit' };
  try {
    await prisma.guild.create({ data: { id: testGuild, eligibleRoleIds: [role], logChannelId: testGuild } });
    const attempts = await Promise.allSettled([discordId, '423456789012345678'].map(id => register(prisma, { ...base, discordId: id })));
    assert.equal(attempts.filter(x => x.status === 'fulfilled').length, 1);
    assert.equal(await prisma.registration.count({ where: { guildId: testGuild } }), 1);
    const winner = attempts.find(x => x.status === 'fulfilled').value.result.discordId;
    await prisma.guild.update({ where: { id: testGuild }, data: { locked: true } });
    await assert.rejects(register(prisma, { ...base, discordId: winner, mode: 'update' }), /closed/);
    assert.equal(await prisma.registration.count({ where: { guildId: testGuild } }), 1);
  } finally {
    await prisma.registration.deleteMany({ where: { guildId: testGuild } });
    await prisma.guild.deleteMany({ where: { id: testGuild } });
  }
});
test('duplicate wallet fails across users; commands isolated per guild', async () => {
  const db = mock();
  await register(db, { guildId, discordId, username: 'a', wallet, roles: [role], mode: 'submit' });
  await assert.rejects(register(db, { guildId, discordId: '423456789012345678', username: 'b', wallet, roles: [role], mode: 'submit' }), /unique/);
});
process.on('beforeExit', () => { client.destroy(); prisma.$disconnect(); });
