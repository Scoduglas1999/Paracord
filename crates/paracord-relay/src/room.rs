use std::collections::HashMap;

use chrono::{DateTime, Utc};
use dashmap::DashMap;

use crate::participant::MediaParticipant;

/// Maximum number of participants per room.
const MAX_PARTICIPANTS: usize = 50;

/// A media room containing participants who can exchange audio/video.
#[derive(Debug, Clone)]
pub struct MediaRoom {
    pub room_id: String,
    pub guild_id: i64,
    pub channel_id: i64,
    pub participants: HashMap<i64, MediaParticipant>,
    pub max_participants: usize,
    pub created_at: DateTime<Utc>,
}

impl MediaRoom {
    pub fn new(room_id: String, guild_id: i64, channel_id: i64) -> Self {
        Self {
            room_id,
            guild_id,
            channel_id,
            participants: HashMap::new(),
            max_participants: MAX_PARTICIPANTS,
            created_at: Utc::now(),
        }
    }

    /// Returns the list of user IDs currently in the room.
    pub fn user_ids(&self) -> Vec<i64> {
        self.participants.keys().copied().collect()
    }

    /// Returns whether the room is empty.
    pub fn is_empty(&self) -> bool {
        self.participants.is_empty()
    }

    /// Returns whether the room is full.
    pub fn is_full(&self) -> bool {
        self.participants.len() >= self.max_participants
    }
}

#[derive(Debug, thiserror::Error)]
pub enum RoomError {
    #[error("room is full (max {0} participants)")]
    RoomFull(usize),
    #[error("room not found: {0}")]
    NotFound(String),
    #[error("user {0} not in room {1}")]
    UserNotInRoom(i64, String),
    #[error("user {0} already in room {1}")]
    AlreadyInRoom(i64, String),
}

/// Thread-safe manager for media rooms.
pub struct MediaRoomManager {
    rooms: DashMap<String, MediaRoom>,
}

impl MediaRoomManager {
    pub fn new() -> Self {
        Self {
            rooms: DashMap::new(),
        }
    }

    /// Get or create a room for the given guild/channel combination.
    /// Returns the room_id.
    pub fn get_or_create_room(&self, guild_id: i64, channel_id: i64) -> String {
        let room_id = format!("guild_{}_channel_{}", guild_id, channel_id);
        self.rooms
            .entry(room_id.clone())
            .or_insert_with(|| MediaRoom::new(room_id.clone(), guild_id, channel_id));
        room_id
    }

    /// Join a participant to a room. Creates the room if it doesn't exist.
    /// Returns the current list of participants (including the new one).
    pub fn join_room(
        &self,
        guild_id: i64,
        channel_id: i64,
        participant: MediaParticipant,
    ) -> Result<Vec<MediaParticipant>, RoomError> {
        let room_id = self.get_or_create_room(guild_id, channel_id);
        let user_id = participant.user_id;

        let mut room = self
            .rooms
            .get_mut(&room_id)
            .ok_or_else(|| RoomError::NotFound(room_id.clone()))?;

        if room.is_full() {
            return Err(RoomError::RoomFull(room.max_participants));
        }

        room.participants.insert(user_id, participant);

        // Auto-subscribe the new participant to everyone else and vice versa.
        let other_ids: Vec<i64> = room
            .participants
            .keys()
            .copied()
            .filter(|&id| id != user_id)
            .collect();

        if let Some(p) = room.participants.get_mut(&user_id) {
            p.subscribe_all(&other_ids);
        }
        for &other_id in &other_ids {
            if let Some(other) = room.participants.get_mut(&other_id) {
                other.subscribe(user_id);
            }
        }

        Ok(room.participants.values().cloned().collect())
    }

    /// Remove a participant from a room.
    /// Returns the remaining participants, or None if the room was destroyed.
    pub fn leave_room(
        &self,
        guild_id: i64,
        channel_id: i64,
        user_id: i64,
    ) -> Option<Vec<MediaParticipant>> {
        let room_id = format!("guild_{}_channel_{}", guild_id, channel_id);

        let result = {
            let mut room = self.rooms.get_mut(&room_id)?;
            room.participants.remove(&user_id);

            // Remove subscriptions to the leaving user.
            for (_, p) in room.participants.iter_mut() {
                p.unsubscribe(user_id);
            }

            if room.is_empty() {
                None
            } else {
                Some(room.participants.values().cloned().collect())
            }
        };

        // If the room is empty, remove it from the map.
        if result.is_none() {
            self.rooms.remove(&room_id);
            tracing::info!(room_id = %room_id, "room destroyed (last participant left)");
        }

        result
    }

    /// Get a snapshot of a room.
    pub fn get_room(&self, room_id: &str) -> Option<MediaRoom> {
        self.rooms.get(room_id).map(|r| r.clone())
    }

    /// Get a room by guild/channel.
    pub fn get_room_by_channel(&self, guild_id: i64, channel_id: i64) -> Option<MediaRoom> {
        let room_id = format!("guild_{}_channel_{}", guild_id, channel_id);
        self.get_room(&room_id)
    }

    /// List all active room IDs.
    pub fn list_rooms(&self) -> Vec<String> {
        self.rooms.iter().map(|r| r.key().clone()).collect()
    }

    /// Get the number of active rooms.
    pub fn room_count(&self) -> usize {
        self.rooms.len()
    }
}

impl Default for MediaRoomManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_participant(user_id: i64) -> MediaParticipant {
        MediaParticipant::new(user_id, format!("session-{}", user_id))
    }

    #[test]
    fn create_and_join_room() {
        let mgr = MediaRoomManager::new();
        let participants = mgr.join_room(1, 100, make_participant(42)).unwrap();
        assert_eq!(participants.len(), 1);
        assert_eq!(participants[0].user_id, 42);
        assert_eq!(mgr.room_count(), 1);
    }

    #[test]
    fn join_multiple_participants() {
        let mgr = MediaRoomManager::new();
        mgr.join_room(1, 100, make_participant(1)).unwrap();
        let participants = mgr.join_room(1, 100, make_participant(2)).unwrap();
        assert_eq!(participants.len(), 2);

        // User 2 should be subscribed to user 1
        let p2 = participants.iter().find(|p| p.user_id == 2).unwrap();
        assert!(p2.subscriptions.contains(&1));

        // User 1 should be subscribed to user 2
        let p1 = participants.iter().find(|p| p.user_id == 1).unwrap();
        assert!(p1.subscriptions.contains(&2));
    }

    #[test]
    fn leave_room_removes_subscriptions() {
        let mgr = MediaRoomManager::new();
        mgr.join_room(1, 100, make_participant(1)).unwrap();
        mgr.join_room(1, 100, make_participant(2)).unwrap();
        mgr.join_room(1, 100, make_participant(3)).unwrap();

        let remaining = mgr.leave_room(1, 100, 2).unwrap();
        assert_eq!(remaining.len(), 2);

        // Remaining participants should not be subscribed to user 2
        for p in &remaining {
            assert!(!p.subscriptions.contains(&2));
        }
    }

    #[test]
    fn leave_last_participant_destroys_room() {
        let mgr = MediaRoomManager::new();
        mgr.join_room(1, 100, make_participant(1)).unwrap();
        let result = mgr.leave_room(1, 100, 1);
        assert!(result.is_none());
        assert_eq!(mgr.room_count(), 0);
    }

    #[test]
    fn get_room_returns_none_for_missing() {
        let mgr = MediaRoomManager::new();
        assert!(mgr.get_room("nonexistent").is_none());
    }

    #[test]
    fn get_or_create_is_idempotent() {
        let mgr = MediaRoomManager::new();
        let id1 = mgr.get_or_create_room(1, 100);
        let id2 = mgr.get_or_create_room(1, 100);
        assert_eq!(id1, id2);
        assert_eq!(mgr.room_count(), 1);
    }

    #[test]
    fn list_rooms() {
        let mgr = MediaRoomManager::new();
        mgr.join_room(1, 100, make_participant(1)).unwrap();
        mgr.join_room(1, 200, make_participant(2)).unwrap();
        let rooms = mgr.list_rooms();
        assert_eq!(rooms.len(), 2);
    }
}
