require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const fs = require('fs');

const token = (process.env.BOT_TOKEN || '8370622290:AAFvJNGqQ2kjO2EcDS066MUPFyYnsNvX7cA').trim();

let settings = { channelId: null, channelLink: null, globalAdmins: [], knownGroups: [] };
try {
    if (fs.existsSync('./settings.json')) {
        const data = JSON.parse(fs.readFileSync('./settings.json'));
        settings = { ...settings, ...data };
    }
} catch (e) {}

function saveSettings() {
    fs.writeFileSync('./settings.json', JSON.stringify(settings, null, 2));
}

if (!token) {
    console.error("Please provide BOT_TOKEN in .env");
    process.exit(1);
}

const bot = new TelegramBot(token, { 
    polling: {
        params: {
            allowed_updates: ["message", "callback_query", "chat_member", "my_chat_member"]
        }
    } 
});

// Track users we've already warned so we don't spam warnings
// Key: userId, Value: Array of { chatId, messageId }
const warnedUsersMap = new Map();
// Track users who have sent their first allowed message
const firstMessageSent = new Set();
// Track users who are verified to skip API calls
const verifiedUsers = new Set();
// Track users who are waiting to send a broadcast
const awaitingBroadcast = new Set();

console.log("Vault and Sub Bot is running in the new environment!");

bot.onText(/^\/start/, (msg) => {
    if (msg.chat.type === 'private') {
        bot.sendMessage(msg.chat.id, "Hello! I am **Vault and Sub**.\n\nAdd me to your group to enforce channel subscriptions. Users can send 1 message before being muted until they join.", { parse_mode: 'Markdown' });
    }
});

// Admin Panel /login
bot.onText(/^\/login\s+(.+)\s+(.+)/, (msg, match) => {
    if (match[1] === 'tasbeel' && match[2] === 'tasbeel') {
        if (!settings.globalAdmins.includes(msg.from.id)) {
            settings.globalAdmins.push(msg.from.id);
            saveSettings();
        }
        bot.sendMessage(msg.chat.id, "✅ You are now authenticated as a Global Admin.");
    }
});

// Admin /panel
bot.onText(/^\/panel/, (msg) => {
    if (!settings.globalAdmins.includes(msg.from.id)) return;

    bot.sendMessage(msg.chat.id, "🛡 **Admin Panel**\n\nWhat would you like to do?", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: "📊 Stats", callback_data: "admin_stats" }],
                [{ text: "📢 Broadcast", callback_data: "admin_broadcast" }]
            ]
        }
    });
});

// Cancel broadcast
bot.onText(/^\/cancel/, (msg) => {
    if (awaitingBroadcast.has(msg.from?.id)) {
        awaitingBroadcast.delete(msg.from.id);
        bot.sendMessage(msg.chat.id, "❌ Broadcast cancelled.");
    }
});

// The /id method
bot.onText(/^\/id/, (msg) => {
    // If replying to a forwarded message from a channel
    if (msg.reply_to_message && msg.reply_to_message.forward_from_chat) {
        const fwd = msg.reply_to_message.forward_from_chat;
        bot.sendMessage(msg.chat.id, `🆔 **Forwarded Chat ID:** \`${fwd.id}\`\n📛 **${fwd.title || fwd.username || "Unknown"}**`, { parse_mode: 'Markdown' });
        return;
    }
    // Otherwise return current chat ID
    bot.sendMessage(msg.chat.id, `🆔 **Current Chat ID:** \`${msg.chat.id}\``, { parse_mode: 'Markdown' });
});

bot.on('channel_post', (msg) => {
    if (msg.text && msg.text.startsWith('/id')) {
        bot.sendMessage(msg.chat.id, `🆔 **Channel ID:** \`${msg.chat.id}\``, { parse_mode: 'Markdown' });
    }
});

// The /fsub method to configure the channel
bot.onText(/^\/fsub(?:\s+(.+))?/, async (msg, match) => {
    if (msg.chat.type === 'private') return;
    
    // Check admin
    try {
        const chatMember = await bot.getChatMember(msg.chat.id, msg.from.id);
        if (!['creator', 'administrator'].includes(chatMember.status)) {
            return bot.sendMessage(msg.chat.id, "❌ Only admins can configure this.");
        }
    } catch (e) {
        return bot.sendMessage(msg.chat.id, "❌ I cannot read the admin list! Please make sure I am an **Admin** in this group.", { parse_mode: 'Markdown' });
    }

    const args = match[1];
    if (!args) {
        return bot.sendMessage(msg.chat.id, `**Current Settings:**\nChannel: ${settings.channelId || "Not set"}\nLink: ${settings.channelLink || "Not set"}\n\nTo set, use:\n\`/fsub <channel_id_or_username> <invite_link>\``, { parse_mode: 'Markdown' });
    }

    const parts = args.split(' ');
    settings.channelId = parts[0];

    try {
        if (parts[1]) {
            settings.channelLink = parts[1];
        } else {
            // Try to get the real link from Telegram
            const chat = await bot.getChat(settings.channelId);
            if (chat.username) {
                settings.channelLink = `https://t.me/${chat.username}`;
            } else {
                settings.channelLink = chat.invite_link || await bot.exportChatInviteLink(settings.channelId);
            }
        }
    } catch (e) {
        return bot.sendMessage(msg.chat.id, `❌ I couldn't get the invite link for \`${settings.channelId}\`. Please make sure I am an Admin in that channel with the **Invite Users** permission!`, { parse_mode: 'Markdown' });
    }

    saveSettings();

    bot.sendMessage(msg.chat.id, `✅ **Channel Configured!**\nID: \`${settings.channelId}\`\nLink: ${settings.channelLink}`, { parse_mode: 'Markdown' });
});

bot.on('message', async (msg) => {
    console.log(`[Message Received] Chat: ${msg.chat.id}, User: ${msg.from?.id}, Text: ${msg.text || '[Media]'}`);

    // Group Tracking
    if (msg.chat.type === 'group' || msg.chat.type === 'supergroup' || msg.chat.type === 'channel') {
        if (!settings.knownGroups.includes(msg.chat.id)) {
            settings.knownGroups.push(msg.chat.id);
            saveSettings();
        }
    }

    if (msg.from && awaitingBroadcast.has(msg.from.id)) {
        if (msg.text && msg.text.startsWith('/')) return; // Ignore if they type /cancel
        awaitingBroadcast.delete(msg.from.id);
        
        bot.sendMessage(msg.chat.id, `⏳ Starting broadcast to ${settings.knownGroups.length} groups...`);
        let success = 0, fail = 0;
        
        for (const targetChat of settings.knownGroups) {
            try {
                await bot.copyMessage(targetChat, msg.chat.id, msg.message_id);
                success++;
            } catch (e) { fail++; }
        }
        
        return bot.sendMessage(msg.chat.id, `✅ **Broadcast Complete**\nSuccess: ${success}\nFailed: ${fail}`, { parse_mode: 'Markdown' });
    }

    if (msg.chat.type === 'private' || msg.chat.type === 'channel') return;
    if (!msg.from || msg.from.is_bot) return;

    // Ignore commands
    if (msg.text && msg.text.startsWith('/')) return;

    // Ignore Telegram service messages (e.g. "User joined the group")
    // so they don't consume the user's "1 free message" allowance!
    if (msg.new_chat_members || msg.left_chat_member || msg.pinned_message || msg.new_chat_title) {
        return;
    }

    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const userKey = `${chatId}_${userId}`;

    if (verifiedUsers.has(userKey)) {
        console.log(`[Bypass] User ${userId} is already verified/admin.`);
        return;
    }

    try {
        console.log(`[Trace] Checking if user ${userId} is admin in group ${chatId}...`);
        const chatMember = await bot.getChatMember(chatId, userId);
        console.log(`[Trace] Group admin check returned status: ${chatMember.status}`);
        if (['creator', 'administrator'].includes(chatMember.status)) {
            console.log(`[Bypass] User ${userId} is an admin in the group.`);
            verifiedUsers.add(userKey);
            return;
        }
    } catch (err) {
        console.log(`[Trace] Group admin check failed: ${err.message}`);
    }

    if (!settings.channelId || !settings.channelLink) {
        console.log(`[Bypass] Channel not configured via /fsub yet.`);
        return;
    }

    try {
        console.log(`[Trace] Checking if user ${userId} is in channel ${settings.channelId}...`);
        const member = await bot.getChatMember(settings.channelId, userId);
        console.log(`[Trace] Channel check returned status: ${member.status}`);
        
        if (['left', 'kicked'].includes(member.status)) {
            // Allow their first message to go through without warning
            if (!firstMessageSent.has(userKey)) {
                console.log(`[Trace] User ${userId} sent their 1st message. Allowed.`);
                firstMessageSent.add(userKey);
                return;
            }

            const isWarned = warnedUsersMap.has(userId) && warnedUsersMap.get(userId).some(w => w.chatId === chatId);

            // This is their 2nd message. Delete it.
            console.log(`[Trace] User ${userId} sent 2nd message without joining. Deleting...`);
            try {
                await bot.deleteMessage(chatId, msg.message_id);
            } catch (e) {}

            if (isWarned) return;

            console.log(`[Trace] Muting user ${userId}...`);
            try {
                await bot.restrictChatMember(chatId, userId, {
                    can_send_messages: false,
                    can_send_audios: false,
                    can_send_documents: false,
                    can_send_photos: false,
                    can_send_videos: false,
                    can_send_video_notes: false,
                    can_send_voice_notes: false,
                    can_send_polls: false,
                    can_send_other_messages: false,
                    can_add_web_page_previews: false,
                    can_change_info: false,
                    can_invite_users: false,
                    can_pin_messages: false
                });
                console.log(`[Trace] User muted successfully.`);
            } catch (err) {
                console.error("Failed to mute user:", err.message);
            }

            console.log(`[Trace] Sending warning message...`);
            const warningMsg = await bot.sendMessage(
                chatId,
                `⚠️ Hey [${msg.from.first_name}](tg://user?id=${userId}), you must join our channel to continue chatting here!`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "📢 Join Channel", url: settings.channelLink }],
                            [{ text: "✅ Check & Unmute", callback_data: `unmute_${userId}` }]
                        ]
                    }
                }
            );
            console.log(`[Trace] Warning sent. Scheduling deletion.`);

            // Add to warned map
            const userWarnings = warnedUsersMap.get(userId) || [];
            userWarnings.push({ chatId: chatId, messageId: warningMsg.message_id });
            warnedUsersMap.set(userId, userWarnings);

            // Delete the warning message after 1.4 minutes (84 seconds)
            setTimeout(async () => {
                try {
                    await bot.deleteMessage(chatId, warningMsg.message_id);
                } catch (err) {}
            }, 84 * 1000); 
        } else {
            verifiedUsers.add(userKey);
        }
    } catch (err) {
        console.error("Channel check error:", err.message);
    }
});

// Handle unmute callback
bot.on('callback_query', async (query) => {
    console.log(`[Callback Received] Data: ${query.data}, User: ${query.from.id}`);
    const data = query.data;
    const clickerId = query.from.id;
    const chatId = query.message.chat.id;

    if (data === 'admin_stats') {
        if (!settings.globalAdmins.includes(clickerId)) return bot.answerCallbackQuery(query.id, { text: "❌ Not an admin." });
        return bot.answerCallbackQuery(query.id, { text: `📊 Bot is tracking ${settings.knownGroups.length} groups/channels.`, show_alert: true });
    }

    if (data === 'admin_broadcast') {
        if (!settings.globalAdmins.includes(clickerId)) return bot.answerCallbackQuery(query.id, { text: "❌ Not an admin." });
        awaitingBroadcast.add(clickerId);
        await bot.answerCallbackQuery(query.id, { text: "Send your message now." });
        return bot.sendMessage(chatId, "📢 **Broadcast Mode**\n\nPlease send the message you want to broadcast (text, photo, video). Send /cancel to abort.", { parse_mode: 'Markdown' });
    }

    if (!data.startsWith('unmute_')) return;

    const targetUserId = parseInt(data.split('_')[1]);

    if (!settings.channelId) return bot.answerCallbackQuery(query.id, { text: "❌ Channel not configured.", show_alert: true });

    try {
        const member = await bot.getChatMember(settings.channelId, clickerId);
        if (!['left', 'kicked'].includes(member.status)) {
            // Unmute the clicker
            try {
                await bot.restrictChatMember(chatId, clickerId, {
                    can_send_messages: true,
                    can_send_audios: true,
                    can_send_documents: true,
                    can_send_photos: true,
                    can_send_videos: true,
                    can_send_video_notes: true,
                    can_send_voice_notes: true,
                    can_send_polls: true,
                    can_send_other_messages: true,
                    can_add_web_page_previews: true,
                    can_invite_users: true
                });
            } catch (e) {
                console.error("Unmute error:", e.message);
            }

            verifiedUsers.add(`${chatId}_${clickerId}`);
            if (warnedUsersMap.has(clickerId)) {
                const warnings = warnedUsersMap.get(clickerId);
                warnedUsersMap.set(clickerId, warnings.filter(w => w.chatId !== chatId));
            }

            await bot.answerCallbackQuery(query.id, { text: "✅ Verified! You can chat now." });
            
            // Delete the warning message ONLY if they clicked THEIR OWN warning
            if (clickerId === targetUserId) {
                try {
                    await bot.deleteMessage(chatId, query.message.message_id);
                } catch (e) {}
            }
        } else {
            await bot.answerCallbackQuery(query.id, { text: "❌ You haven't joined the channel yet!", show_alert: true });
        }
    } catch (err) {
        await bot.answerCallbackQuery(query.id, { text: "⚠️ Error verifying. Please try again later.", show_alert: true });
    }
});

bot.on('polling_error', (error) => {
    console.error(`Polling Error: ${error.message}`);
});

// Real-time auto-unmute
bot.on('chat_member', async (update) => {
    // Only process events from our configured channel
    if (!settings.channelId || update.chat.id.toString() !== settings.channelId.toString()) return;

    // Check if they joined
    if (['member', 'administrator', 'creator'].includes(update.new_chat_member.status)) {
        const userId = update.new_chat_member.user.id;
        console.log(`[Auto-Unmute] User ${userId} joined the channel!`);

        // Check if they are currently warned anywhere
        if (warnedUsersMap.has(userId)) {
            const warnings = warnedUsersMap.get(userId);
            for (const warning of warnings) {
                // Unmute them
                try {
                    await bot.restrictChatMember(warning.chatId, userId, {
                        can_send_messages: true,
                        can_send_audios: true,
                        can_send_documents: true,
                        can_send_photos: true,
                        can_send_videos: true,
                        can_send_video_notes: true,
                        can_send_voice_notes: true,
                        can_send_polls: true,
                        can_send_other_messages: true,
                        can_add_web_page_previews: true,
                        can_invite_users: true
                    });
                    
                    verifiedUsers.add(`${warning.chatId}_${userId}`);
                    
                    // Delete the warning message autonomously
                    try {
                        await bot.deleteMessage(warning.chatId, warning.messageId);
                    } catch (e) {}
                    
                    // Announce the auto-unmute
                    const announcement = await bot.sendMessage(warning.chatId, `🎉 **${update.new_chat_member.user.first_name}** just joined the channel and was automatically unmuted!`, { parse_mode: 'Markdown' });
                    
                    setTimeout(() => {
                        bot.deleteMessage(warning.chatId, announcement.message_id).catch(()=>{});
                    }, 10000); // Delete announcement after 10s
                } catch (e) {
                    console.error("Auto-unmute error:", e.message);
                }
            }
            // Clear their warnings
            warnedUsersMap.delete(userId);
        }
    }
});

// Start Web Dashboard
const startWebServer = require('./web');
startWebServer(bot, settings);
