import 'dotenv/config';
import { Client, GatewayIntentBits, Events, MessageFlags, PermissionFlagsBits, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder, OverwriteType } from 'discord.js';
import { PrismaClient, Prisma } from '@prisma/client';

export const prisma = new PrismaClient();
export const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const PRIVATE = MessageFlags.Ephemeral;
const ids = { wallet: 'wl:wallet' };
const snowflake = /^\d{17,20}$/;
export function mention(kind, id) {
  if (!snowflake.test(id ?? '')) return id;
  return kind === 'role' ? `<@&${id}>` : kind === 'channel' ? `<#${id}>` : `<@${id}>`;
}
export const memberHelp = [
  'Whitelist registration',
  '1. You need a role approved by the admins.',
  '2. Use /submit and enter an EVM address (0x + 40 hexadecimal characters) in the private form.',
  '3. Use /check to see your saved wallet privately. Use /update to replace it.',
  'One Discord account can save one wallet; each wallet can belong to only one account in this server.',
  'Registration may close or have a deadline. Wallet format is checked, but ownership is not verified.',
  'Wallet replies are private. Do not post your wallet in a public channel.'
].join('\n');
export const adminHelp = [
  'Whitelist setup (Administrator permission required)',
  '1. Create a text channel visible only to administrators and the bot. Give the bot View Channel and Send Messages.',
  '2. In this server, run /whitelist log and choose that channel. Non-admin visibility is rejected.',
  '3. Run /whitelist role-add for each eligible role (for example Gold WL and Silver WL). Use role-remove to revoke a role.',
  '4. Members use /submit, /check and /update. Wallet input opens a private form.',
  'Use /whitelist stats to check settings and counts. Use lock to close or reopen registration.',
  'Deadline: /whitelist deadline utc:2026-12-01 12:00 (UTC). Set a future time. To remove it, use /whitelist deadline utc:clear.',
  'Use lookup for one member, export for a private CSV, and snapshot for an immutable private CSV.',
  'Wallets are not proof of ownership. Protect admin access, the log channel, and exported CSV files.'
].join('\n');
export function normalizeWallet(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value.trim())) throw new Error('Enter an EVM address: 0x followed by 40 hexadecimal characters.');
  return value.trim().toLowerCase();
}
export function csv(rows, roles = new Map()) {
  const fields = ['discordId', 'username', 'wallet', 'eligibleRole', 'createdAt', 'updatedAt'];
  const cell = value => {
    let text = value instanceof Date ? `${value.toISOString().slice(0, 19).replace('T', ' ')} UTC` : String(value ?? '');
    if (/^[\s\x00-\x1f]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [fields.join(','), ...rows.map(row => [row.discordId, row.username, row.wallet, roles.get(row.eligibleRoleId)?.name ?? 'Deleted role', row.createdAt, row.updatedAt].map(cell).join(','))].join('\r\n') + '\r\n';
}
async function guildLock(tx, guildId) {
  await tx.guild.upsert({ where: { id: guildId }, create: { id: guildId }, update: {} });
  await tx.$queryRaw`SELECT "id" FROM "Guild" WHERE "id" = ${guildId} FOR UPDATE`;
  return tx.guild.findUniqueOrThrow({ where: { id: guildId } });
}
export function formatDeadline(date) {
  if (!date) return 'none';
  const seconds = Math.floor(date.getTime() / 1000);
  return `<t:${seconds}:F> (<t:${seconds}:R>)`;
}
export function parseDeadline(input, now = new Date()) {
  if (input === 'clear') return null;
  const short = /^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(input);
  if (!short && !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(input)) throw new Error('Use YYYY-MM-DD HH:mm (UTC) or clear.');
  const canonical = short ? `${input.replace(' ', 'T')}:00Z` : input;
  const date = new Date(canonical);
  if (Number.isNaN(date.valueOf()) || date.toISOString().replace('.000Z', 'Z') !== canonical || date <= now) throw new Error('Deadline must be a valid future UTC time.');
  return date;
}
function open(guild) {
  if (!guild.eligibleRoleIds.length || !guild.logChannelId) throw new Error('Registration requires eligible roles and an admin-only log channel.');
  if (guild.locked || (guild.deadline && guild.deadline <= new Date())) throw new Error('Registration is closed.');
}
export async function register(db, { guildId, discordId, username, wallet, roles, mode }) {
  if (!snowflake.test(guildId) || !snowflake.test(discordId) || !['submit', 'update'].includes(mode) || typeof username !== 'string' || !username || username.length > 128 || !Array.isArray(roles) || !roles.every(id => typeof id === 'string' && snowflake.test(id))) throw new Error('Invalid registration input.');
  const canonical = normalizeWallet(wallet);
  // Guild row lock serializes settings, snapshots and writes, including wallet uniqueness races.
  return db.$transaction(async tx => {
    const guild = await guildLock(tx, guildId);
    open(guild);
    const matchedRole = guild.eligibleRoleIds.find(id => roles.includes(id));
    if (!matchedRole) throw new Error('Eligible role required.');
    const key = { guildId_discordId: { guildId, discordId } };
    const existing = await tx.registration.findUnique({ where: key });
    if (mode === 'submit' && existing) throw new Error('Already registered. Use Update.');
    if (mode === 'update' && !existing) throw new Error('No registration found. Use Submit.');
    const data = { username, wallet: canonical, eligibleRoleId: matchedRole };
    const result = mode === 'submit'
      ? await tx.registration.create({ data: { ...data, guildId, discordId } })
      : await tx.registration.update({ where: key, data });
    return { result, logChannelId: guild.logChannelId };
  });
}
// Reject any effective non-admin role access, including inherited channel permissions.
export async function adminLogChannel(channel, guildId) {
  if (!channel || !channel.isTextBased() || !channel.send || channel.guildId !== guildId || !channel.guild || !channel.permissionsFor) throw new Error('Admin-only text log channel required.');
  const roles = await channel.guild.roles.fetch();
  for (const role of roles.values()) {
    if (!role.permissions.has(PermissionFlagsBits.Administrator) && channel.permissionsFor(role)?.has(PermissionFlagsBits.ViewChannel)) throw new Error('Log channel is visible to non-admin roles.');
  }
  // Member-specific View Channel allows can bypass role denies. Reject even admin-specific allows: fail closed.
  if (channel.permissionOverwrites.cache.some(o => o.type === OverwriteType.Member && o.allow.has(PermissionFlagsBits.ViewChannel))) throw new Error('Log channel has member-specific view access.');
  return channel;
}
async function log(channelId, guildId, message) {
  const channel = await client.channels.fetch(channelId, { force: true });
  await adminLogChannel(channel, guildId);
  await channel.send({ content: message, allowedMentions: { parse: [] } });
}
function errorText(error) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return 'Wallet or Discord account already registered in this server.';
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return 'Database conflict. Please retry.';
  if (error instanceof Error && !('code' in error) && /^(Enter an EVM|Invalid registration|Registration |Eligible role|Admin-only|Log channel|Already registered|No registration|Use YYYY-MM-DD|Deadline must)/.test(error.message)) return error.message;
  console.error('Interaction failed:', error);
  return 'Request failed. Please try again or contact an administrator.';
}
async function settings(guildId, change) {
  return prisma.$transaction(async tx => {
    await guildLock(tx, guildId);
    return tx.guild.update({ where: { id: guildId }, data: change });
  });
}
export async function changeRole(db, guildId, roleId, action) {
  return db.$transaction(async tx => {
    const guild = await guildLock(tx, guildId);
    const roles = guild.eligibleRoleIds;
    const eligibleRoleIds = action === 'add' ? [...new Set([...roles, roleId])] : roles.filter(id => id !== roleId);
    return tx.guild.update({ where: { id: guildId }, data: { eligibleRoleIds } });
  });
}
async function handle(i) {
  if (!i.inGuild() || !i.guildId || !snowflake.test(i.guildId)) { await i.reply({ content: 'Server only.', flags: PRIVATE }); return; }
  const admin = i.memberPermissions?.has(PermissionFlagsBits.Administrator) === true;
  if (i.isChatInputCommand() && ['submit', 'update'].includes(i.commandName)) {
    const modal = new ModalBuilder().setCustomId(`${ids.wallet}:${i.commandName}`).setTitle('Whitelist wallet');
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('address').setLabel('EVM wallet address').setStyle(TextInputStyle.Short).setMinLength(42).setMaxLength(42).setRequired(true)));
    await i.showModal(modal); return;
  }
  if (i.isModalSubmit() && /^wl:wallet:(submit|update)$/.test(i.customId)) {
    await i.deferReply({ flags: PRIVATE });
    const mode = i.customId.split(':')[2];
    const member = await i.guild.members.fetch(i.user.id);
    const configured = await prisma.guild.findUnique({ where: { id: i.guildId } });
    if (!configured?.logChannelId) throw new Error('Registration requires eligible roles and an admin-only log channel.');
    await adminLogChannel(await client.channels.fetch(configured.logChannelId, { force: true }), i.guildId);
    const { result, logChannelId } = await register(prisma, { guildId: i.guildId, discordId: i.user.id, username: i.user.username, wallet: i.fields.getTextInputValue('address'), roles: [...member.roles.cache.keys()], mode });
    let logFailed = false;
    try { await log(logChannelId, i.guildId, `${mode} by ${mention('user', i.user.id)} in ${i.guild.name}; wallet ${result.wallet}; eligible role ${mention('role', result.eligibleRoleId)}.`); }
    catch (error) { console.error('Admin wallet log failed:', error); logFailed = true; }
    await i.editReply(logFailed
      ? `${mode === 'submit' ? 'Registered' : 'Updated'} your wallet, but the admin log failed. Contact an administrator; do not resubmit.`
      : `${mode === 'submit' ? 'Registered' : 'Updated'} your wallet. Use /check to view it privately.`);
    return;
  }
  if (!i.isChatInputCommand()) return;
  if (i.commandName === 'check') {
    await i.deferReply({ flags: PRIVATE });
    const entry = await prisma.registration.findUnique({ where: { guildId_discordId: { guildId: i.guildId, discordId: i.user.id } } });
    await i.editReply(entry ? `Your wallet: ${entry.wallet}` : 'No registration found.'); return;
  }
  if (i.commandName === 'helpmember') { await i.reply({ content: memberHelp, flags: PRIVATE }); return; }
  if (i.commandName === 'helpadmin') {
    await i.reply({ content: admin ? adminHelp : 'Administrator permission required.', flags: PRIVATE }); return;
  }
  if (i.commandName !== 'whitelist') return;
  if (!admin) { await i.reply({ content: 'Administrator permission required.', flags: PRIVATE }); return; }
  const action = i.options.getSubcommand();
  await i.deferReply({ flags: PRIVATE });
  if (action === 'role-add' || action === 'role-remove') {
    const role = i.options.getRole('role', true);
    if (role.guild.id !== i.guildId || role.id === i.guildId) throw new Error('Invalid server role.');
    const guild = await changeRole(prisma, i.guildId, role.id, action === 'role-add' ? 'add' : 'remove');
    await i.editReply({ content: `Eligible roles: ${guild.eligibleRoleIds.map(id => mention('role', id)).join(', ') || 'none'}.`, allowedMentions: { parse: [] } }); return;
  }
  if (action === 'log') {
    const target = i.options.getChannel('channel', true);
    await adminLogChannel(target, i.guildId);
    await settings(i.guildId, { logChannelId: target.id });
    await i.editReply({ content: `Admin log channel set to ${mention('channel', target.id)}.`, allowedMentions: { parse: [] } }); return;
  }
  if (action === 'lock') { const locked = i.options.getBoolean('enabled', true); await settings(i.guildId, { locked }); await i.editReply(`Registration ${locked ? 'locked' : 'unlocked'}.`); return; }
  if (action === 'deadline') {
    const date = parseDeadline(i.options.getString('utc', true));
    await settings(i.guildId, { deadline: date }); await i.editReply(date ? `Deadline: ${formatDeadline(date)}` : 'Deadline cleared.'); return;
  }
  if (action === 'lookup') {
    const user = i.options.getUser('user', true);
    const entry = await prisma.registration.findUnique({ where: { guildId_discordId: { guildId: i.guildId, discordId: user.id } } });
    await i.editReply({ content: entry ? `User: ${mention('user', entry.discordId)}\nWallet: ${entry.wallet}\nEligible role: ${mention('role', entry.eligibleRoleId)}\nCreated: ${entry.createdAt.toISOString()}\nUpdated: ${entry.updatedAt.toISOString()}` : 'No registration found.', allowedMentions: { parse: [] } }); return;
  }
  if (action === 'stats') { const [guild, count, snapshots] = await Promise.all([prisma.guild.findUnique({ where: { id: i.guildId } }), prisma.registration.count({ where: { guildId: i.guildId } }), prisma.snapshot.count({ where: { guildId: i.guildId } })]); await i.editReply({ content: `Registrations: ${count}\nSnapshots: ${snapshots}\nRoles: ${guild?.eligibleRoleIds.map(id => mention('role', id)).join(', ') || 'not set'}\nLocked: ${guild?.locked ?? false}\nDeadline: ${formatDeadline(guild?.deadline)}\nLog channel: ${guild?.logChannelId ? mention('channel', guild.logChannelId) : 'none'}`, allowedMentions: { parse: [] } }); return; }
  if (action === 'export' || action === 'snapshot') {
    const roles = await i.guild.roles.fetch();
    // Snapshot and registration writes share guild row lock: immutable CSV reflects one committed state.
    const result = await prisma.$transaction(async tx => {
      await guildLock(tx, i.guildId);
      const rows = await tx.registration.findMany({ where: { guildId: i.guildId }, orderBy: { discordId: 'asc' } });
      const content = csv(rows, roles);
      const snapshot = action === 'snapshot' ? await tx.snapshot.create({ data: { guildId: i.guildId, count: rows.length, csv: content } }) : null;
      return { content, count: rows.length, snapshot };
    });
    const filename = result.snapshot ? `whitelist-snapshot-${result.snapshot.id}.csv` : `whitelist-${i.guildId}.csv`;
    await i.editReply({ content: `${result.count} registrations${result.snapshot ? `; snapshot ${result.snapshot.id} saved` : ''}. Private CSV attached.`, files: [new AttachmentBuilder(Buffer.from(result.content), { name: filename })] });
    const guild = await prisma.guild.findUnique({ where: { id: i.guildId } });
    if (guild?.logChannelId) try { await log(guild.logChannelId, i.guildId, `${action} by Discord ID ${i.user.id} in guild ${i.guildId}; ${result.count} rows${result.snapshot ? `; snapshot ${result.snapshot.id}` : ''}.`); } catch (error) { console.error('Admin export log failed:', error); await i.followUp({ content: 'Export succeeded, but admin log failed.', flags: PRIVATE }); }
    return;
  }
}
client.on(Events.InteractionCreate, async i => {
  try { await handle(i); }
  catch (error) {
    const content = errorText(error);
    try {
      if (i.deferred) await i.editReply({ content, files: [] });
      else if (i.replied) await i.followUp({ content, flags: PRIVATE });
      else await i.reply({ content, flags: PRIVATE });
    } catch (replyError) { console.error('Cannot respond to interaction:', replyError); }
  }
});
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  if (!process.env.DISCORD_TOKEN || !process.env.DATABASE_URL) { console.error('Set DISCORD_TOKEN and DATABASE_URL.'); process.exitCode = 1; }
  else client.login(process.env.DISCORD_TOKEN).catch(error => { console.error('Login failed:', error); process.exitCode = 1; });
}
