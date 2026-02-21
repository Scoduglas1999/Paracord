use paracord_core::AppState;
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::Notify;

const WELCOME_BOT_ID: i64 = -1;
const AUTO_MOD_ID: i64 = -2;

pub fn spawn_bot_manager(state: AppState, shutdown: Arc<Notify>) {
    let db = state.db.clone();
    tokio::spawn(async move {
        ensure_system_bots(&db).await;

        let mut rx = state.event_bus.subscribe_system();
        tracing::info!("Native Bot Manager started");
        loop {
            tokio::select! {
                _ = shutdown.notified() => {
                    tracing::info!("Native Bot Manager shutting down");
                    break;
                }
                Ok(event) = rx.recv() => {
                    handle_event(&state, event).await;
                }
                else => break,
            }
        }
    });
}

async fn ensure_system_bots(pool: &paracord_db::DbPool) {
    let _ = paracord_db::users::create_user(
        pool,
        WELCOME_BOT_ID,
        "Welcome Bot",
        0,
        "welcome@paracord.internal",
        "",
    )
    .await;

    let _ = paracord_db::users::create_user(
        pool,
        AUTO_MOD_ID,
        "Auto-Moderator",
        0,
        "automod@paracord.internal",
        "",
    )
    .await;
}

async fn handle_event(state: &AppState, event: paracord_core::events::ServerEvent) {
    let guild_id = match event.guild_id {
        Some(id) => id,
        None => return, // Bots currently only operate in guilds
    };

    let guild = match paracord_db::guilds::get_guild(&state.db, guild_id).await {
        Ok(Some(g)) => g,
        _ => return,
    };

    let bot_settings_str = match &guild.bot_settings {
        Some(s) => s,
        None => return,
    };

    let bot_settings: Value = match serde_json::from_str(bot_settings_str) {
        Ok(v) => v,
        Err(_) => return,
    };

    match event.event_type.as_str() {
        "GUILD_MEMBER_ADD" => {
            handle_welcome_bot(state, guild_id, &bot_settings, &event.payload).await;
        }
        "MESSAGE_CREATE" => {
            handle_auto_mod(state, guild_id, &bot_settings, &event.payload).await;
        }
        _ => {}
    }
}

async fn handle_welcome_bot(
    state: &AppState,
    guild_id: i64,
    bot_settings: &Value,
    event_data: &Value,
) {
    let welcome_bot = bot_settings.get("welcome_bot");
    if welcome_bot.is_none()
        || welcome_bot
            .unwrap()
            .get("enabled")
            .and_then(|v| v.as_bool())
            != Some(true)
    {
        return;
    }

    let wb = welcome_bot.unwrap();
    let channel_id_str = match wb.get("channel_id").and_then(|v| v.as_str()) {
        Some(c) => c,
        None => return,
    };
    let channel_id: i64 = match channel_id_str.parse() {
        Ok(id) => id,
        Err(_) => return,
    };

    let template = wb
        .get("message_template")
        .and_then(|v| v.as_str())
        .unwrap_or("Welcome to the server, {user}!");

    let username = event_data
        .get("user")
        .and_then(|u| u.get("username").and_then(|v| v.as_str()))
        .unwrap_or("User");
    let content = template.replace("{user}", username);

    let msg_id = paracord_util::snowflake::generate(1);

    if let Ok(msg) = paracord_db::messages::create_message(
        &state.db,
        msg_id,
        channel_id,
        WELCOME_BOT_ID,
        &content,
        0,
        None,
    )
    .await
    {
        let msg_json = serde_json::json!({
            "id": msg.id.to_string(),
            "channel_id": msg.channel_id.to_string(),
            "author_id": msg.author_id.to_string(),
            "content": msg.content,
            "nonce": msg.nonce,
            "message_type": msg.message_type,
            "flags": msg.flags,
            "pinned": msg.pinned,
            "e2ee_header": msg.e2ee_header,
            "created_at": msg.created_at.to_rfc3339(),
            "edited_at": msg.edited_at.map(|d| d.to_rfc3339()),
            "author": {
                "id": WELCOME_BOT_ID.to_string(),
                "username": "Welcome Bot",
                "discriminator": 0,
                "avatar_hash": serde_json::Value::Null,
            }
        });
        state
            .event_bus
            .dispatch("MESSAGE_CREATE", msg_json, Some(guild_id));
    }
}

async fn handle_auto_mod(
    state: &AppState,
    guild_id: i64,
    bot_settings: &Value,
    event_data: &Value,
) {
    let auto_mod = bot_settings.get("auto_mod");
    if auto_mod.is_none()
        || auto_mod
            .unwrap()
            .get("enabled")
            .and_then(|v| v.as_bool())
            != Some(true)
    {
        return;
    }
    let am = auto_mod.unwrap();

    let author_id_str = event_data.get("author_id").and_then(|v| v.as_str());
    if let Some(author_id_str) = author_id_str {
        if author_id_str == WELCOME_BOT_ID.to_string() || author_id_str == AUTO_MOD_ID.to_string() {
            return;
        }
    }

    let content = match event_data.get("content").and_then(|v| v.as_str()) {
        Some(c) => c.to_lowercase(),
        None => return,
    };

    let banned_words = match am.get("banned_words").and_then(|v| v.as_str()) {
        Some(w) => w
            .split(',')
            .map(|s| s.trim().to_lowercase())
            .collect::<Vec<String>>(),
        None => return,
    };

    for word in banned_words {
        if !word.is_empty() && content.contains(&word) {
            let msg_id_str = match event_data.get("id").and_then(|v| v.as_str()) {
                Some(id) => id,
                None => continue,
            };
            let msg_id: i64 = match msg_id_str.parse() {
                Ok(id) => id,
                Err(_) => continue,
            };
            let channel_id_str = match event_data.get("channel_id").and_then(|v| v.as_str()) {
                Some(id) => id,
                None => continue,
            };
            let channel_id: i64 = match channel_id_str.parse() {
                Ok(id) => id,
                Err(_) => continue,
            };

            if let Ok(_) = paracord_db::messages::delete_message(&state.db, msg_id).await {
                state.event_bus.dispatch(
                    "MESSAGE_DELETE",
                    serde_json::json!({
                        "id": msg_id_str,
                        "channel_id": channel_id_str,
                    }),
                    Some(guild_id),
                );

                let warning_id = paracord_util::snowflake::generate(1);
                let warning_content =
                    format!("A message was removed for containing restricted words.");
                if let Ok(warning_msg) = paracord_db::messages::create_message(
                    &state.db,
                    warning_id,
                    channel_id,
                    AUTO_MOD_ID,
                    &warning_content,
                    0,
                    None,
                )
                .await
                {
                    let msg_json = serde_json::json!({
                        "id": warning_msg.id.to_string(),
                        "channel_id": warning_msg.channel_id.to_string(),
                        "author_id": warning_msg.author_id.to_string(),
                        "content": warning_msg.content,
                        "created_at": warning_msg.created_at.to_rfc3339(),
                        "author": {
                            "id": AUTO_MOD_ID.to_string(),
                            "username": "Auto-Moderator",
                            "discriminator": 0,
                            "avatar_hash": serde_json::Value::Null,
                        }
                    });
                    state
                        .event_bus
                        .dispatch("MESSAGE_CREATE", msg_json, Some(guild_id));
                }
            }
            break;
        }
    }
}
