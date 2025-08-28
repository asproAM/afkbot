// status can be "online", "idle", "dnd", or "invisible" or "offline"
export default [
    
    {
        channelId: "1409676167098663135",
        serverId: "1409643963480281110",
        token: process.env.token1,
        selfDeaf: false,
        autoReconnect: {
            enabled: true,
            delay: 5, // ثواني
            maxRetries: 5,
        },
        presence: {
            status: "idle",
        },
        selfMute: false,
    },
];