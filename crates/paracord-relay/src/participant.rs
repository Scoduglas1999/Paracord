use std::collections::HashSet;
use std::net::SocketAddr;

use serde::{Deserialize, Serialize};

/// How this participant is connected to the media server.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConnectionType {
    /// Media flows through the relay server.
    ServerRelay,
    /// Media flows directly between peers.
    P2P,
}

/// A participant in a media room with connection and subscription state.
#[derive(Debug, Clone)]
pub struct MediaParticipant {
    /// The user's unique ID.
    pub user_id: i64,
    /// Unique session identifier for this connection.
    pub session_id: String,
    /// How this participant is connected.
    pub connection_type: ConnectionType,
    /// Set of user_ids whose media this participant receives.
    pub subscriptions: HashSet<i64>,
    /// Whether the participant has muted themselves.
    pub muted: bool,
    /// Whether the participant has deafened themselves.
    pub deafened: bool,
    /// The participant's publicly reachable address (for P2P).
    pub public_addr: Option<SocketAddr>,
}

impl MediaParticipant {
    pub fn new(user_id: i64, session_id: String) -> Self {
        Self {
            user_id,
            session_id,
            connection_type: ConnectionType::ServerRelay,
            subscriptions: HashSet::new(),
            muted: false,
            deafened: false,
            public_addr: None,
        }
    }

    /// Subscribe to another user's media.
    pub fn subscribe(&mut self, user_id: i64) {
        self.subscriptions.insert(user_id);
    }

    /// Unsubscribe from another user's media.
    pub fn unsubscribe(&mut self, user_id: i64) {
        self.subscriptions.remove(&user_id);
    }

    /// Subscribe to all other participants' media given a list of user IDs.
    pub fn subscribe_all(&mut self, user_ids: &[i64]) {
        for &uid in user_ids {
            if uid != self.user_id {
                self.subscriptions.insert(uid);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_participant_defaults() {
        let p = MediaParticipant::new(42, "sess-1".to_string());
        assert_eq!(p.user_id, 42);
        assert_eq!(p.session_id, "sess-1");
        assert_eq!(p.connection_type, ConnectionType::ServerRelay);
        assert!(p.subscriptions.is_empty());
        assert!(!p.muted);
        assert!(!p.deafened);
        assert!(p.public_addr.is_none());
    }

    #[test]
    fn subscribe_unsubscribe() {
        let mut p = MediaParticipant::new(1, "s".to_string());
        p.subscribe(2);
        p.subscribe(3);
        assert!(p.subscriptions.contains(&2));
        assert!(p.subscriptions.contains(&3));

        p.unsubscribe(2);
        assert!(!p.subscriptions.contains(&2));
        assert!(p.subscriptions.contains(&3));
    }

    #[test]
    fn subscribe_all_excludes_self() {
        let mut p = MediaParticipant::new(1, "s".to_string());
        p.subscribe_all(&[1, 2, 3, 4]);
        assert!(!p.subscriptions.contains(&1));
        assert!(p.subscriptions.contains(&2));
        assert!(p.subscriptions.contains(&3));
        assert!(p.subscriptions.contains(&4));
    }
}
