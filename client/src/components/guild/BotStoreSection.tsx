import { useState, useMemo, useEffect } from 'react';
import { Bot, Check, Shield, Search, Zap, Volume2, Gamepad2, Wrench, ArrowRight, Smile, Settings, Save, Trash2, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useGuildStore } from '../../stores/guildStore';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

interface BotStoreSectionProps {
    guildId: string;
    canManage: boolean;
}

interface BuiltInBot {
    id: string; // Internal identifier for the native bot
    name: string;
    description: string;
    icon: React.ReactNode;
    color: string;
    features: string[];
}

const BUILT_IN_BOTS: BuiltInBot[] = [
    {
        id: 'welcome_bot',
        name: 'Welcome Bot',
        description: 'Automatically greet new members when they join the server.',
        icon: <Smile className="text-accent-success" size={24} />,
        color: 'var(--accent-success)',
        features: ['Customizable welcome message', 'Channel selection'],
    },
    {
        id: 'auto_mod',
        name: 'Auto-Moderator',
        description: 'Keep your server safe by automatically filtering bad words and spam.',
        icon: <Shield className="text-accent-danger" size={24} />,
        color: 'var(--accent-danger)',
        features: ['Profanity filter', 'Auto-delete messages'],
    },
];

const UPCOMING_BOTS: BuiltInBot[] = [
    {
        id: 'system-roles',
        name: 'Role Assigner',
        description: 'Let users instantly self-assign optional roles via clickable buttons.',
        icon: <Zap className="text-accent-primary" size={24} />,
        color: 'var(--accent-primary)',
        features: ['Reaction roles', 'Button UI', 'Multiple role categories'],
    },
    {
        id: 'system-economy',
        name: 'Economy & Leveling',
        description: 'Gamify your server with XP, levels, and leaderboards for active members.',
        icon: <Gamepad2 className="text-accent-warning" size={24} />,
        color: 'var(--accent-warning)',
        features: ['Activity tracking', 'Level up alerts', 'Server leaderboard'],
    },
    {
        id: 'system-polls',
        name: 'Polls & Voting',
        description: 'Quickly spin up robust, multi-option polls with real-time tracking.',
        icon: <Volume2 className="text-text-secondary" size={24} />,
        color: 'var(--interactive-normal)',
        features: ['Multiple choices', 'Anonymous voting', 'Timed polls'],
    }
];

export function BotStoreSection({ guildId, canManage }: BotStoreSectionProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [installingId, setInstallingId] = useState<string | null>(null);
    const [configuringId, setConfiguringId] = useState<string | null>(null);

    // Config state mapping
    const [configState, setConfigState] = useState<Record<string, any>>({});

    const guild = useGuildStore(state => state.guilds.find(g => g.id === guildId));
    const updateGuild = useGuildStore(state => state.updateGuild);
    const botSettings = useMemo(() => guild?.bot_settings || {}, [guild?.bot_settings]);

    useEffect(() => {
        // Initialize config state from database when modal opens
        if (configuringId && botSettings[configuringId]) {
            setConfigState(botSettings[configuringId] || {});
        } else {
            setConfigState({});
        }
    }, [configuringId, botSettings]);

    const filteredBots = useMemo(() => {
        const allBots = [...BUILT_IN_BOTS, ...UPCOMING_BOTS];
        if (!searchQuery.trim()) return allBots;
        const q = searchQuery.toLowerCase();
        return allBots.filter(b => b.name.toLowerCase().includes(q) || b.description.toLowerCase().includes(q));
    }, [searchQuery]);

    const isInstalled = (botId: string) => {
        return botSettings[botId]?.enabled === true;
    };

    const handleInstall = async (botId: string) => {
        if (!canManage) return;
        setInstallingId(botId);

        let initialConfig: any = { enabled: true };
        if (botId === 'welcome_bot') {
            initialConfig = { ...initialConfig, channel_id: guild?.default_channel_id || '', message_template: 'Welcome to the server, {user}!' };
        } else if (botId === 'auto_mod') {
            initialConfig = { ...initialConfig, banned_words: 'badword1,badword2' };
        }

        const newSettings = { ...botSettings, [botId]: initialConfig };
        try {
            await updateGuild(guildId, { bot_settings: newSettings });
            setConfiguringId(botId);
        } finally {
            setInstallingId(null);
        }
    };

    const handleUninstall = async (botId: string) => {
        if (!canManage) return;
        const newSettings = { ...botSettings };
        if (newSettings[botId]) {
            newSettings[botId].enabled = false;
        }
        await updateGuild(guildId, { bot_settings: newSettings });
        setConfiguringId(null);
    };

    const saveConfig = async () => {
        if (!canManage || !configuringId) return;
        const newSettings = { ...botSettings, [configuringId]: { ...configState, enabled: true } };
        await updateGuild(guildId, { bot_settings: newSettings });
        setConfiguringId(null);
    };

    return (
        <div className="settings-surface-card min-h-[calc(100dvh-13.5rem)] !p-8 max-sm:!p-6 card-stack-relaxed">
            <div className="flex flex-col gap-2 mb-6">
                <h2 className="settings-section-title !mb-0 flex items-center gap-2">
                    <Bot size={20} className="text-accent-primary" />
                    Bot Store
                </h2>
                <p className="text-sm text-text-muted">
                    Instantly install official, native Paracord bots to enhance your server. No hosting or tokens required.
                </p>
            </div>

            <div className="relative mb-6">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-muted">
                    <Search size={16} />
                </div>
                <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search for bots..."
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border-subtle bg-bg-mod-subtle/50 text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-interactive-normal focus:bg-bg-mod-subtle"
                />
            </div>

            {configuringId && (
                <div className="mb-6 p-5 border border-border-subtle bg-bg-mod-subtle rounded-xl shadow-lg relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-accent-primary" />
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-semibold text-text-primary text-base">Configure {filteredBots.find(b => b.id === configuringId)?.name}</h3>
                        <button onClick={() => setConfiguringId(null)} className="text-text-muted hover:text-text-primary transition-colors">
                            <X size={20} />
                        </button>
                    </div>

                    <div className="flex flex-col gap-4 mb-5">
                        {configuringId === 'welcome_bot' && (
                            <>
                                <div>
                                    <label className="settings-label">Welcome Channel ID</label>
                                    <Input
                                        value={configState.channel_id || ''}
                                        onChange={(e) => setConfigState({ ...configState, channel_id: e.target.value })}
                                        placeholder="Channel Snowflake ID"
                                    />
                                    <p className="settings-description mt-1 text-xs">The channel where welcome messages will be posted.</p>
                                </div>
                                <div>
                                    <label className="settings-label">Message Template</label>
                                    <textarea
                                        value={configState.message_template || ''}
                                        onChange={(e) => setConfigState({ ...configState, message_template: e.target.value })}
                                        className="w-full h-24 p-3 rounded-lg border border-border-subtle bg-bg-secondary text-sm text-text-primary outline-none transition-colors focus:border-interactive-normal resize-none"
                                        placeholder="Welcome to the server, {user}!"
                                    />
                                    <p className="settings-description mt-1 text-xs">Use <code>{'{user}'}</code> to mention the new member.</p>
                                </div>
                            </>
                        )}
                        {configuringId === 'auto_mod' && (
                            <>
                                <div>
                                    <label className="settings-label">Banned Words List</label>
                                    <textarea
                                        value={configState.banned_words || ''}
                                        onChange={(e) => setConfigState({ ...configState, banned_words: e.target.value })}
                                        className="w-full h-24 p-3 rounded-lg border border-border-subtle bg-bg-secondary text-sm text-text-primary outline-none transition-colors focus:border-interactive-normal resize-none"
                                        placeholder="badword1, anotherword, spamlink"
                                    />
                                    <p className="settings-description mt-1 text-xs">Comma separated list of words. Any message containing these will be automatically deleted.</p>
                                </div>
                            </>
                        )}
                    </div>

                    <div className="flex items-center justify-between pt-4 border-t border-border-subtle/50">
                        <Button variant="destructive" size="sm" onClick={() => handleUninstall(configuringId)} className="gap-1.5 flex items-center">
                            <Trash2 size={14} /> Remove Bot
                        </Button>
                        <div className="flex items-center gap-2">
                            <Button variant="ghost" size="sm" onClick={() => setConfiguringId(null)}>Cancel</Button>
                            <Button variant="default" size="sm" onClick={saveConfig} className="gap-1.5 flex items-center shadow-lg shadow-accent-primary/20">
                                <Save size={14} /> Save Changes
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredBots.map((bot) => {
                    const isUpcoming = UPCOMING_BOTS.some(b => b.id === bot.id);
                    const installed = isInstalled(bot.id);

                    return (
                        <div key={bot.id} className={cn("card-surface flex flex-col rounded-2xl border border-border-subtle bg-bg-mod-subtle/40 p-5 transition-colors",
                            installed ? "border-accent-primary/50 shadow-sm shadow-accent-primary/5" : "hover:border-border-strong hover:bg-bg-mod-subtle/60"
                        )}>
                            <div className="flex items-start gap-4 mb-4">
                                <div
                                    className="w-12 h-12 flex items-center justify-center rounded-xl flex-shrink-0"
                                    style={{ backgroundColor: `color-mix(in srgb, ${bot.color} 15%, transparent)` }}
                                >
                                    {bot.icon}
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-base font-bold text-text-primary">{bot.name}</h3>
                                        {installed && <span className="text-[10px] font-bold uppercase tracking-wider text-accent-primary bg-accent-primary/10 px-2 py-0.5 rounded-full">Active</span>}
                                        {isUpcoming && <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted bg-bg-secondary px-2 py-0.5 rounded-full">Coming Soon</span>}
                                    </div>
                                    <p className="text-[13px] text-text-muted mt-0.5 line-clamp-2 leading-relaxed">
                                        {bot.description}
                                    </p>
                                </div>
                            </div>

                            <div className="flex flex-col gap-2 mb-6 flex-1">
                                <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Features</span>
                                <ul className="flex flex-col gap-1.5">
                                    {bot.features.map((feature, i) => (
                                        <li key={i} className="flex items-center gap-2 text-[13px] text-text-secondary">
                                            <Check size={14} className="text-text-muted" />
                                            {feature}
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            <div className="mt-auto pt-4 border-t border-border-subtle/50 flex items-center justify-between">
                                <span className="text-xs font-semibold text-text-muted flex items-center gap-1">
                                    <Wrench size={12} />
                                    Native App
                                </span>
                                {isUpcoming ? (
                                    <button disabled className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-bg-secondary text-text-muted cursor-not-allowed">
                                        In Development
                                    </button>
                                ) : installed ? (
                                    <button
                                        onClick={() => setConfiguringId(bot.id)}
                                        disabled={!canManage}
                                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors bg-bg-secondary hover:bg-bg-mod-strong text-text-normal border border-border-subtle"
                                    >
                                        <Settings size={14} /> Configure
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => handleInstall(bot.id)}
                                        disabled={!canManage || installingId === bot.id}
                                        className={cn(
                                            "inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-70 disabled:cursor-not-allowed",
                                            "bg-accent-primary hover:bg-accent-primary-hover text-white shadow-sm shadow-accent-primary/20 hover:shadow-accent-primary/40"
                                        )}
                                    >
                                        {installingId === bot.id ? 'Installing...' : 'Add to Server'}
                                        {installingId !== bot.id && <ArrowRight size={14} />}
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
                {filteredBots.length === 0 && (
                    <div className="col-span-full py-12 flex flex-col items-center justify-center text-center">
                        <Bot size={40} className="text-text-muted mb-3 opacity-50" />
                        <h3 className="text-base font-semibold text-text-primary mb-1">No bots found</h3>
                        <p className="text-sm text-text-muted">Try adjusting your search terms.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
