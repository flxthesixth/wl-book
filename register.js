import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
const command = new SlashCommandBuilder().setName('whitelist').setDescription('Manage whitelist registration').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).setDMPermission(false);
for (const action of ['add', 'remove']) command.addSubcommand(s => s.setName(`role-${action}`).setDescription(`${action} eligible role`).addRoleOption(o => o.setName('role').setDescription('Eligible role').setRequired(true)));
command.addSubcommand(s => s.setName('log').setDescription('Set admin log channel').addChannelOption(o => o.setName('channel').setDescription('Text channel').addChannelTypes(ChannelType.GuildText).setRequired(true)));
command.addSubcommand(s => s.setName('lock').setDescription('Lock or unlock registration').addBooleanOption(o => o.setName('enabled').setDescription('Lock enabled').setRequired(true)));
command.addSubcommand(s => s.setName('deadline').setDescription('Set UTC deadline or clear').addStringOption(o => o.setName('utc').setDescription('Example: 2026-12-01 12:00 (UTC), or clear').setRequired(true)));
command.addSubcommand(s => s.setName('lookup').setDescription('Find registration').addUserOption(o => o.setName('user').setDescription('Discord user').setRequired(true)));
for (const [name, description] of [['stats', 'View configuration and counts'], ['export', 'Export current CSV privately'], ['snapshot', 'Save immutable snapshot and export CSV privately']]) command.addSubcommand(s => s.setName(name).setDescription(description));
const helpMember = new SlashCommandBuilder().setName('helpmember').setDescription('How to register and manage your wallet').setDMPermission(false);
const helpAdmin = new SlashCommandBuilder().setName('helpadmin').setDescription('How to set up the whitelist bot').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).setDMPermission(false);
export const commands = [command, helpMember, helpAdmin, ...[['submit', 'Register your wallet privately'], ['update', 'Change your saved wallet privately'], ['check', 'Check your saved wallet privately']].map(([name, description]) => new SlashCommandBuilder().setName(name).setDescription(description).setDMPermission(false))];
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  if (!process.env.DISCORD_TOKEN || !/^\d{17,20}$/.test(process.env.DISCORD_CLIENT_ID ?? '') || !/^\d{17,20}$/.test(process.env.DISCORD_GUILD_ID ?? '')) { console.error('Set DISCORD_TOKEN, DISCORD_CLIENT_ID and DISCORD_GUILD_ID.'); process.exitCode = 1; }
  else new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN).put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID), { body: commands.map(c => c.toJSON()) }).then(() => console.log('Guild commands registered.')).catch(error => { console.error('Command registration failed:', error); process.exitCode = 1; });
}
