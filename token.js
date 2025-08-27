// status can be "online", "idle", "dnd", or "invisible" or "offline"
export default [
    
    {
        channelId: "1282365673955393576",
        serverId: "1282363930643005481",
        token: process.env.token2,
        selfDeaf: false,
        autoReconnect: {
            enabled: true,
            delay: 5, // ثواني
            maxRetries: 5,
        },
        presence: {
            status: "idle",
        },
        selfMute: true,
    },
];