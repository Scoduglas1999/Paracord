use std::collections::{HashMap, HashSet};
use std::sync::{Arc, RwLock};
use tokio::sync::broadcast;

#[derive(Debug, Clone)]
pub struct ServerEvent {
    pub event_type: String,
    pub payload: serde_json::Value,
    /// Guild ID this event belongs to, if applicable.
    pub guild_id: Option<i64>,
    /// When set, only deliver this event to the specified user IDs (e.g. DM recipients).
    pub target_user_ids: Option<Vec<i64>>,
}

/// Broadcast-based event bus for real-time dispatch.
#[derive(Clone)]
pub struct EventBus {
    capacity: usize,
    sessions: Arc<RwLock<HashMap<String, SessionSubscription>>>,
}

#[derive(Clone)]
struct SessionSubscription {
    user_id: i64,
    guild_ids: HashSet<i64>,
    sender: broadcast::Sender<ServerEvent>,
}

impl EventBus {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity,
            sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn register_session(
        &self,
        session_id: impl Into<String>,
        user_id: i64,
        guild_ids: &[i64],
    ) -> broadcast::Receiver<ServerEvent> {
        let (sender, receiver) = broadcast::channel(self.capacity.max(64));
        let subscription = SessionSubscription {
            user_id,
            guild_ids: guild_ids.iter().copied().collect(),
            sender,
        };

        let mut sessions = match self.sessions.write() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        sessions.insert(session_id.into(), subscription);
        receiver
    }

    pub fn unregister_session(&self, session_id: &str) {
        let mut sessions = match self.sessions.write() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        sessions.remove(session_id);
    }

    pub fn add_session_guild(&self, session_id: &str, guild_id: i64) {
        let mut sessions = match self.sessions.write() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        if let Some(subscription) = sessions.get_mut(session_id) {
            subscription.guild_ids.insert(guild_id);
        }
    }

    pub fn remove_session_guild(&self, session_id: &str, guild_id: i64) {
        let mut sessions = match self.sessions.write() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        if let Some(subscription) = sessions.get_mut(session_id) {
            subscription.guild_ids.remove(&guild_id);
        }
    }

    fn subscription_matches(subscription: &SessionSubscription, event: &ServerEvent) -> bool {
        if let Some(targets) = event.target_user_ids.as_ref() {
            return targets.contains(&subscription.user_id);
        }
        match event.guild_id {
            Some(guild_id) => subscription.guild_ids.contains(&guild_id),
            None => true,
        }
    }

    pub fn publish(&self, event: ServerEvent) {
        let senders: Vec<broadcast::Sender<ServerEvent>> = {
            let sessions = match self.sessions.read() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };

            sessions
                .values()
                .filter(|subscription| Self::subscription_matches(subscription, &event))
                .map(|subscription| subscription.sender.clone())
                .collect()
        };

        for sender in senders {
            let _ = sender.send(event.clone());
        }
    }

    /// Helper: publish a typed event with guild_id
    pub fn dispatch(&self, event_type: &str, payload: serde_json::Value, guild_id: Option<i64>) {
        self.publish(ServerEvent {
            event_type: event_type.to_string(),
            payload,
            guild_id,
            target_user_ids: None,
        });
    }

    /// Helper: publish a targeted event delivered only to the specified users.
    pub fn dispatch_to_users(
        &self,
        event_type: &str,
        payload: serde_json::Value,
        target_user_ids: Vec<i64>,
    ) {
        self.publish(ServerEvent {
            event_type: event_type.to_string(),
            payload,
            guild_id: None,
            target_user_ids: Some(target_user_ids),
        });
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new(4096)
    }
}
